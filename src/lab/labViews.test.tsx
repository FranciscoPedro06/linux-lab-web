// @vitest-environment jsdom
// The lab page's areas on a phone: one shown at a time, bash first, and switching never
// mounts the terminal again. The layout itself is CSS (LabPage.module.css), read here as
// text; a browser checks how it renders.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ana, api, apiError, lab, labId, missionDetail, renderAt } from '../testSupport.tsx'
import type { ResultNode, ValidationRun } from './api.ts'
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
      return (
        <div data-testid="terminal">
          {props.labId}
          <textarea aria-label="Terminal input" />
        </div>
      )
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

// Screen width as the browser reports it: below 40rem the lab shows one area at a time.
function screenIs(width: 'phone' | 'wide') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width === 'phone' && query === '(max-width: 40rem)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

// The page's own live region, outside the areas that are hidden on a phone.
function announcer(): HTMLElement {
  const element = document.querySelector('main > [aria-live="polite"][aria-atomic="true"]')
  if (!(element instanceof HTMLElement)) throw new Error('no announcer')
  return element
}

function validationRun(result: ResultNode | null, overrides: Partial<ValidationRun> = {}) {
  return {
    run_id: 1,
    outcome: result?.status ?? 'error',
    newly_completed: false,
    mission: { slug: 'sample-file', version: 1 },
    progress: { status: 'not_completed', completed_version: null, completed_at: null },
    result,
    ...overrides,
  }
}

const twoOfThree: ResultNode = {
  kind: 'all',
  status: 'failed',
  message: null,
  children: [
    { kind: 'check', id: 'a', status: 'passed', message: 'A.' },
    { kind: 'check', id: 'b', status: 'failed', message: 'B.' },
    { kind: 'check', id: 'c', status: 'passed', message: 'C.' },
  ],
}

function pending() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => {
    release = resolve
  })
  return {
    route: () => promise,
    release: (response: Response) => act(async () => release(response)),
  }
}

describe('announcing a finished validation', () => {
  const validatePath = `POST /api/labs/${labId}/validate`

  // On a phone: Verificar is pressed on Critérios, then the student goes back to bash,
  // types there, and the run finishes while Terminal is shown.
  async function finishOnTerminal(response: Response) {
    const run = pending()
    api.routes[validatePath] = run.route
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')
    fireEvent.click(within(views()).getByRole('button', { name: 'Critérios' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await screen.findByRole('button', { name: 'Verificando…' })
    fireEvent.click(within(views()).getByRole('button', { name: 'Terminal' }))
    const input = screen.getByRole('textbox', { name: 'Terminal input' })
    input.focus()
    // Nothing is said while the run is in progress.
    expect(announcer().textContent).toBe('')
    await run.release(response)
    await waitFor(() => expect(announcer().textContent).not.toBe(''))
    // The area shown and the focus stay where the student left them.
    expect(pressed()).toEqual(['Terminal'])
    expect(document.activeElement).toBe(input)
    return announcer().textContent
  }

  beforeEach(() => screenIs('phone'))

  it('says nothing when the page opens', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    expect(announcer().textContent).toBe('')
  })

  it('announces a passed run, with its count, while Terminal is shown', async () => {
    const passed: ResultNode = {
      kind: 'all',
      status: 'passed',
      message: null,
      children: [
        { kind: 'check', id: 'a', status: 'passed', message: 'A.' },
        { kind: 'check', id: 'b', status: 'passed', message: 'B.' },
      ],
    }
    const text = await finishOnTerminal(
      Response.json(
        validationRun(passed, {
          newly_completed: true,
          progress: { status: 'completed', completed_version: 1, completed_at: 'x' },
        }),
      ),
    )
    expect(text).toBe(
      'Missão concluída: o laboratório atende a todos os critérios. 2 de 2 critérios atendidos.',
    )
  })

  it('announces a failed run with its count', async () => {
    const text = await finishOnTerminal(Response.json(validationRun(twoOfThree)))
    expect(text).toBe('Missão ainda não concluída. 2 de 3 critérios atendidos.')
  })

  it('announces a run that could not check the lab', async () => {
    const result: ResultNode = {
      kind: 'all',
      status: 'error',
      message: null,
      children: [
        { kind: 'check', id: 'a', status: 'passed', message: 'A.' },
        { kind: 'check', id: 'b', status: 'error', message: 'B.' },
      ],
    }
    const text = await finishOnTerminal(Response.json(validationRun(result)))
    expect(text).toBe(
      'Não foi possível verificar o laboratório agora. Isso não conta como tentativa. 1 de 2 critérios atendidos (1 não verificado).',
    )
  })

  it('announces a refused request', async () => {
    const refused = apiError(429, 'rate_limited', 'Muitas verificações em pouco tempo.')
    const text = await finishOnTerminal(await refused(undefined))
    expect(text).toBe('Erro: Muitas verificações em pouco tempo.')
  })

  it('announces once: re-renders and opening Critérios do not announce it again', async () => {
    await finishOnTerminal(Response.json(validationRun(twoOfThree)))
    const said = announcer().firstElementChild

    for (const name of ['Histórico', 'Terminal', 'Critérios']) {
      fireEvent.click(within(views()).getByRole('button', { name }))
    }

    // The same text node: nothing new for a screen reader to read.
    expect(announcer().firstElementChild).toBe(said)
    // Critérios shows the whole result, without a live region of its own for this run.
    const panel = screen.getByRole('region', { name: 'Verificação' })
    expect(panel.textContent).toContain('Missão ainda não concluída. 2 de 3 critérios atendidos.')
    expect(within(panel).queryByRole('status')).toBeNull()
    expect(within(panel).queryByRole('alert')).toBeNull()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
  })

  it('announces each new run, even with the same result', async () => {
    api.routes[validatePath] = () => Response.json(validationRun(twoOfThree))
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await waitFor(() => expect(announcer().textContent).not.toBe(''))
    const first = announcer().firstElementChild
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await waitFor(() => expect(announcer().firstElementChild).not.toBe(first))

    expect(announcer().textContent).toBe('Missão ainda não concluída. 2 de 3 critérios atendidos.')
    expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(2)
  })

  it('leaves the announcement to the panel while Critérios is shown', async () => {
    api.routes[validatePath] = () => Response.json(validationRun(twoOfThree))
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')
    fireEvent.click(within(views()).getByRole('button', { name: 'Critérios' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))

    const panel = screen.getByRole('region', { name: 'Verificação' })
    await waitFor(() =>
      expect(within(panel).getByRole('status').textContent).toBe(
        'Missão ainda não concluída. 2 de 3 critérios atendidos.',
      ),
    )
    expect(announcer().textContent).toBe('')
  })

  it('leaves the announcement to the panel where every area is shown', async () => {
    screenIs('wide')
    api.routes[validatePath] = () => Response.json(validationRun(twoOfThree))
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))

    const panel = screen.getByRole('region', { name: 'Verificação' })
    await waitFor(() => expect(within(panel).getByRole('status')).toBeTruthy())
    expect(announcer().textContent).toBe('')
  })
})

describe('the switcher names', () => {
  it('names the buttons by their area only, and says which is shown', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByTestId('terminal')

    for (const name of ['Terminal', 'Critérios', 'Histórico']) {
      expect(
        within(views()).getByRole('button', { name, pressed: name === 'Terminal' }),
      ).toBeTruthy()
    }
  })

  it('draws the brackets with empty alternative text, so names do not include them', () => {
    const phone = labPageCss.slice(labPageCss.indexOf('@media (max-width: 40rem)'))
    expect(phone).toMatch(/\.views button::before \{\s*content: '\[';\s*content: '\[' \/ '';/)
    expect(phone).toMatch(/\.views button::after \{\s*content: '\]';\s*content: '\]' \/ '';/)
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
