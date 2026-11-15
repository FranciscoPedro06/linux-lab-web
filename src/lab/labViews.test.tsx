// @vitest-environment jsdom
// The lab page's areas on a phone: one shown at a time, bash first, and switching never
// mounts the terminal again. The layout itself is CSS (LabPage.module.css), read here as
// text; a browser checks how it renders.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ana, api, lab, labId, missionDetail, renderAt } from '../testSupport.tsx'
import labPageCss from './LabPage.module.css?raw'
import validationCss from './ValidationPanel.module.css?raw'

const terminal = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  sessions: [] as number[],
  insertResult: 'inserted' as 'inserted' | 'not_connected' | 'needs_bracketed_paste',
  inserted: [] as string[],
}))

vi.mock('../terminal/Terminal.tsx', async () => {
  const { useLayoutEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    Terminal: (props: {
      labId: string
      session: number
      insertRef?: { current: ((text: string) => string) | null }
    }) => {
      if (terminal.sessions.at(-1) !== props.session) terminal.sessions.push(props.session)
      useLayoutEffect(() => {
        terminal.mounts += 1
        if (props.insertRef) {
          props.insertRef.current = (text: string) => {
            terminal.inserted.push(text)
            return terminal.insertResult
          }
        }
        return () => {
          terminal.unmounts += 1
        }
      }, [props.insertRef])
      return <div data-testid="terminal">{props.labId}</div>
    },
  }
})

const historyRoute = `GET /api/labs/${labId}/history?after=0&limit=500`

function views() {
  return screen.getByRole('group', { name: 'Área do laboratório' })
}

function pressed(): string[] {
  return within(views())
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '')
}

function workspace(): HTMLElement {
  const element = screen.getByTestId('terminal').closest('[data-view]')
  if (!(element instanceof HTMLElement)) throw new Error('no workspace')
  return element
}

beforeEach(() => {
  terminal.mounts = 0
  terminal.unmounts = 0
  terminal.sessions = []
  terminal.insertResult = 'inserted'
  terminal.inserted = []
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
    [historyRoute]: () =>
      Response.json({
        entries: [{ seq: 1, command: 'chmod 600 ~/.env', recorded_at: '2026-09-30T12:01:00Z' }],
        more: false,
      }),
    'GET /api/missions/sample-file': () => Response.json(missionDetail()),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

describe('the lab areas', () => {
  it('offers Terminal, Critérios and Histórico, with Terminal shown first', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    expect(
      within(views())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Terminal', 'Critérios', 'Histórico'])
    expect(pressed()).toEqual(['Terminal'])
    expect(workspace().dataset.view).toBe('terminal')
    // Each button names the area it shows.
    for (const button of within(views()).getAllByRole('button')) {
      const target = document.getElementById(button.getAttribute('aria-controls') ?? '')
      expect(target).toBeTruthy()
      expect(workspace().contains(target)).toBe(true)
    }
  })

  it('switches areas without mounting the terminal again or opening another session', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    for (const name of ['Critérios', 'Histórico', 'Terminal', 'Histórico', 'Terminal']) {
      fireEvent.click(within(views()).getByRole('button', { name }))
      expect(pressed()).toEqual([name])
    }

    expect(terminal.mounts).toBe(1)
    expect(terminal.unmounts).toBe(0)
    expect(terminal.sessions).toEqual([0])
    // The other areas stay mounted too: the validation and the history are still there.
    expect(screen.getByRole('region', { name: 'Verificação' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Histórico de comandos' })).toBeTruthy()
  })

  it('keeps a validation result and its count while another area is shown', async () => {
    api.routes[`POST /api/labs/${labId}/validate`] = () =>
      Response.json({
        run_id: 1,
        outcome: 'failed',
        newly_completed: false,
        mission: { slug: 'sample-file', version: 1 },
        progress: { status: 'not_completed', completed_version: null, completed_at: null },
        result: {
          kind: 'all',
          status: 'failed',
          message: null,
          children: [
            { kind: 'check', id: 'a', status: 'passed', message: 'A.' },
            { kind: 'check', id: 'b', status: 'failed', message: 'B.' },
          ],
        },
      })
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    fireEvent.click(within(views()).getByRole('button', { name: 'Critérios' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    const status = () =>
      within(screen.getByRole('region', { name: 'Verificação' })).getByRole('status').textContent
    await waitFor(() =>
      expect(status()).toBe('Missão ainda não concluída. 1 de 2 critérios atendidos.'),
    )

    fireEvent.click(within(views()).getByRole('button', { name: 'Terminal' }))
    fireEvent.click(within(views()).getByRole('button', { name: 'Critérios' }))
    expect(status()).toBe('Missão ainda não concluída. 1 de 2 critérios atendidos.')
    expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1)
  })

  it('offers no Critérios for a lab without a mission', async () => {
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab({ mission: null }))
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    expect(
      within(views())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Terminal', 'Histórico'])
  })

  it('shows bash after a command is inserted from the history', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')
    fireEvent.click(within(views()).getByRole('button', { name: 'Histórico' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Inserir no terminal' }))

    expect(terminal.inserted).toEqual(['chmod 600 ~/.env'])
    expect(pressed()).toEqual(['Terminal'])
    expect(terminal.mounts).toBe(1)
  })

  it('stays on the history, with its message, when nothing could be inserted', async () => {
    terminal.insertResult = 'not_connected'
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')
    fireEvent.click(within(views()).getByRole('button', { name: 'Histórico' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Inserir no terminal' }))

    expect(pressed()).toEqual(['Histórico'])
    expect(await screen.findByText('O terminal não está conectado.')).toBeTruthy()
  })
})

describe('the layout rules', () => {
  // The media query blocks of LabPage.module.css, by condition.
  function media(condition: string): string {
    const start = labPageCss.indexOf(`@media (${condition})`)
    expect(start).toBeGreaterThan(-1)
    const next = labPageCss.indexOf('@media', start + 1)
    return labPageCss.slice(start, next === -1 ? undefined : next)
  }

  it('hides the switcher where every area fits', () => {
    expect(labPageCss).toMatch(/\.views \{\s*display: none;\s*\}/)
  })

  it('shows one area at a time on a phone, hiding the others without unmounting them', () => {
    const phone = media('max-width: 40rem')
    expect(phone).toMatch(/\.views \{\s*display: flex;/)
    expect(phone).toContain(".workspace[data-view='terminal'] .side")
    expect(phone).toContain(".workspace:not([data-view='terminal']) .terminal")
    expect(phone).toContain(".workspace[data-view='criteria'] .history")
    expect(phone).toContain(".workspace[data-view='history'] .criteria")
    expect(phone).toMatch(/\.workspace\[data-view='history'\] \.criteria \{\s*display: none;/)
  })

  it('gives the phone controls a 44px touch target', () => {
    const phone = media('max-width: 40rem')
    expect(phone).toMatch(/\.views button \{[^}]*min-height: 44px;/)
    expect(phone).toMatch(/\.actions button \{[^}]*min-height: 44px;/)
  })

  it('tells focus from the shown area on the switcher', () => {
    const phone = media('max-width: 40rem')
    expect(phone).toMatch(/\.views button\[aria-pressed='true'\] \{[^}]*background: var\(--fg\);/)
    expect(phone).toMatch(/\.views button:focus-visible \{\s*outline: 1px solid var\(--fg\);/)
  })

  it('stacks the side column under bash below 64rem', () => {
    expect(media('max-width: 64rem')).toMatch(
      /\.workspace \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    )
  })

  it('lays the criteria out by the panel width, compact in a narrow panel', () => {
    expect(validationCss).toMatch(/container-type: inline-size;/)
    const narrow = validationCss.slice(validationCss.indexOf('@container (max-width: 60ch)'))
    expect(narrow).toMatch(/\.item \{\s*padding-left: 2ch;\s*text-indent: -2ch;/)
    expect(narrow).toMatch(/\.badge \{\s*min-width: 0;/)
  })
})
