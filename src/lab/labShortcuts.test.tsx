// @vitest-environment jsdom
// The area shortcuts on the lab page: one listener before the terminal's input, which
// switches and focuses areas for the shortcuts only and lets every other key through.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ana, api, lab, labId, missionDetail, renderAt } from '../testSupport.tsx'
import labPageCss from './LabPage.module.css?raw'
import { AREA_SHORTCUTS } from './shortcuts.ts'

// A stand-in for the terminal: its input is xterm.js's textarea, and every key that
// reaches it is recorded, as xterm.js would send it to the shell.
const terminal = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  sessions: [] as number[],
  keys: [] as string[],
}))

vi.mock('../terminal/Terminal.tsx', async () => {
  const { useLayoutEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    Terminal: (props: { labId: string; session: number }) => {
      if (terminal.sessions.at(-1) !== props.session) terminal.sessions.push(props.session)
      useLayoutEffect(() => {
        terminal.mounts += 1
        return () => {
          terminal.unmounts += 1
        }
      }, [])
      return (
        <div data-testid="terminal">
          <textarea
            className="xterm-helper-textarea"
            aria-label="Terminal input"
            onKeyDown={(event) => terminal.keys.push(event.code)}
          />
        </div>
      )
    },
  }
})

function input(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Terminal input' })
}

function pressed(): string[] {
  return within(screen.getByRole('group', { name: 'Área do laboratório' }))
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '')
}

// Presses a key on `target` and says whether the page kept it from the terminal.
function key(target: Element, init: KeyboardEventInit): boolean {
  return !fireEvent.keyDown(target, init)
}

const shortcut = (digit: 1 | 2 | 3) => ({
  ctrlKey: true,
  shiftKey: true,
  code: `Digit${digit}`,
  key: '!',
})

beforeEach(() => {
  terminal.mounts = 0
  terminal.unmounts = 0
  terminal.sessions = []
  terminal.keys = []
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
    [`GET /api/labs/${labId}/history?after=0&limit=500`]: () =>
      Response.json({
        entries: [{ seq: 1, command: 'ls -l', recorded_at: '2026-09-30T12:01:00Z' }],
        more: false,
      }),
    'GET /api/missions/sample-file': () => Response.json(missionDetail({ requires_answer: true })),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

async function ready() {
  renderAt(`/labs/${labId}`)
  await screen.findByRole('button', { name: 'Copiar' })
  input().focus()
}

describe('the area shortcuts', () => {
  it('switch areas from the terminal, focus them, and never reach the shell', async () => {
    await ready()

    expect(key(input(), shortcut(2))).toBe(true)
    expect(pressed()).toEqual(['Critérios'])
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Verificação' }))

    expect(key(document.activeElement as Element, shortcut(3))).toBe(true)
    expect(pressed()).toEqual(['Histórico'])
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Histórico de comandos' }),
    )

    expect(key(document.activeElement as Element, shortcut(1))).toBe(true)
    expect(pressed()).toEqual(['Terminal'])
    expect(document.activeElement).toBe(input())

    expect(terminal.keys).toEqual([])
  })

  it('do nothing more when the area is already the one shown and focused', async () => {
    await ready()
    const copy = screen.getByRole('button', { name: 'Copiar' })
    key(input(), shortcut(3))
    copy.focus()

    expect(key(copy, shortcut(3))).toBe(true)
    expect(pressed()).toEqual(['Histórico'])
    expect(document.activeElement).toBe(copy)
    expect(key(input(), shortcut(1))).toBe(true)
    expect(key(input(), shortcut(1))).toBe(true)
    expect(document.activeElement).toBe(input())
    expect(terminal.keys).toEqual([])
  })

  it('keep a held shortcut from the shell without switching again', async () => {
    await ready()
    key(input(), shortcut(2))
    input().focus()

    expect(key(input(), { ...shortcut(3), repeat: true })).toBe(true)
    expect(pressed()).toEqual(['Critérios'])
    expect(terminal.keys).toEqual([])
  })

  it('let every other key reach the terminal untouched', async () => {
    await ready()
    const others: KeyboardEventInit[] = [
      { code: 'KeyL', key: 'l' },
      { ctrlKey: true, code: 'KeyC', key: 'c' },
      { ctrlKey: true, code: 'KeyV', key: 'v' },
      { ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' },
      { ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' },
      { ctrlKey: true, code: 'KeyA', key: 'a' },
      { ctrlKey: true, code: 'KeyR', key: 'r' },
      { ctrlKey: true, shiftKey: true, code: 'Digit4', key: '$' },
      { altKey: true, code: 'Digit1', key: '1' },
      { ctrlKey: true, code: 'Digit1', key: '1' },
    ]
    for (const init of others) expect(key(input(), init)).toBe(false)

    expect(terminal.keys).toEqual(others.map((init) => init.code))
    expect(pressed()).toEqual(['Terminal'])
  })

  it('do not act while text is being composed', async () => {
    await ready()

    expect(key(input(), { ...shortcut(2), isComposing: true })).toBe(false)
    expect(pressed()).toEqual(['Terminal'])
  })

  it('do not act in the answer field', async () => {
    await ready()
    const answer = await screen.findByRole('textbox', { name: /Sua resposta/ })
    answer.focus()

    expect(key(answer, shortcut(1))).toBe(false)
    expect(document.activeElement).toBe(answer)
    expect(pressed()).toEqual(['Terminal'])
  })

  it('do not act inside the reset confirmation', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar laboratório' }))
    const cancel = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' })
    expect(document.activeElement).toBe(cancel)

    expect(key(cancel, shortcut(3))).toBe(false)
    expect(document.activeElement).toBe(cancel)
    expect(pressed()).toEqual(['Terminal'])
  })

  it('never mount the terminal again or open another session', async () => {
    await ready()
    for (const digit of [2, 3, 1, 3, 2, 1] as const)
      key(document.activeElement as Element, shortcut(digit))

    expect(terminal.mounts).toBe(1)
    expect(terminal.unmounts).toBe(0)
    expect(terminal.sessions).toEqual([0])
    expect(terminal.keys).toEqual([])
  })

  it('keep Critérios out of reach for a lab without a mission', async () => {
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab({ mission: null }))
    await ready()

    expect(key(input(), shortcut(2))).toBe(true)
    expect(pressed()).toEqual(['Terminal'])
    expect(document.activeElement).toBe(input())
  })
})

describe('the shortcuts shown', () => {
  it('name the shortcuts the page handles, on each area and switcher button', async () => {
    await ready()
    const areas = {
      terminal: input().closest('section'),
      criteria: screen.getByRole('region', { name: 'Verificação' }),
      history: screen.getByRole('region', { name: 'Histórico de comandos' }),
    }
    for (const [name, { label, aria }] of Object.entries(AREA_SHORTCUTS)) {
      const area = areas[name as keyof typeof areas]
      // Drawn from data-shortcut on the area (or its wrapper), told by aria-keyshortcuts.
      expect(area?.closest('[data-shortcut]')?.getAttribute('data-shortcut')).toBe(label)
      expect(area?.getAttribute('aria-keyshortcuts')).toBe(aria)
    }
    const switcher = screen.getByRole('group', { name: 'Área do laboratório' })
    expect(
      within(switcher)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-keyshortcuts')),
    ).toEqual(['Control+Shift+1', 'Control+Shift+2', 'Control+Shift+3'])
    // The labels are not text: names stay the area's alone.
    expect(
      within(switcher)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Terminal', 'Critérios', 'Histórico'])
  })

  it('draw the labels only with a keyboard and a fine pointer, and not on a phone', () => {
    const start = labPageCss.indexOf(
      '@media (min-width: 40.01rem) and (hover: hover) and (pointer: fine)',
    )
    expect(start).toBeGreaterThan(-1)
    const block = labPageCss.slice(start, labPageCss.indexOf('\n}\n', start))
    expect(block).toMatch(/content: attr\(data-shortcut\);\s*content: attr\(data-shortcut\) \/ '';/)
    expect(block).toContain('.terminal::after')
    expect(block).toContain('.criteria::before')
    expect(block).toContain('.history::before')
    // Nowhere else: the phone keeps its switcher only.
    expect(labPageCss.split('attr(data-shortcut)')).toHaveLength(3)
  })

  it('mark a panel reached with its shortcut like the active panel', () => {
    expect(labPageCss).toMatch(
      /\.criteria > section:focus-visible,\s*\.history > section:focus-visible \{\s*outline: none;\s*border-color: var\(--fg\);/,
    )
  })
})
