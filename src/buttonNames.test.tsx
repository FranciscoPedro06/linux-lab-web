// @vitest-environment jsdom
// Buttons are drawn "[ Copiar ]" and hints "[+] Dica 1", but named Copiar and Dica 1: the
// brackets are generated content with empty alternative text (src/index.css). jsdom does
// not compute generated content, so the CSS is read as text here, and the names on the
// pages are checked for what the markup gives them; Chromium's accessibility tree was
// checked against the production build.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexCss from './index.css?raw'
import {
  ana,
  api,
  catalogModule,
  lab,
  labId,
  missionCard,
  missionDetail,
  renderAt,
} from './testSupport.tsx'

vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

// The declarations of one rule of src/index.css.
function rule(selector: string): string {
  const start = indexCss.indexOf(`\n${selector} {`)
  expect(start).toBeGreaterThan(-1)
  return indexCss.slice(start, indexCss.indexOf('}', start))
}

describe('the drawn brackets', () => {
  it.each([
    ['button::before', "'[ '"],
    ['button::after', "' ]'"],
    ['summary::before', "'[+] '"],
    ['details[open] > summary::before', "'[-] '"],
  ])('%s still draws %s, with empty alternative text', (selector, drawn) => {
    const declarations = rule(selector)
    // A plain value first, for browsers without alternative text; then the same with ''.
    expect(declarations).toContain(`content: ${drawn};\n  content: ${drawn} / '';`)
  })

  it('leaves the buttons drawn without brackets as they were', () => {
    expect(rule("button[type='submit']::before,\nbutton[type='submit']::after")).toContain(
      'content: none;',
    )
  })
})

// Every button of the page: a name, and no bracket in it.
function names(): string[] {
  const buttons = screen.getAllByRole('button')
  return buttons.map((button) => {
    const name = button.textContent ?? ''
    expect(name.trim()).not.toBe('')
    expect(name).not.toMatch(/[[\]]/)
    return name
  })
}

describe('the names on the pages', () => {
  beforeEach(() => {
    api.routes = {
      'GET /api/auth/me': () => Response.json(ana),
      'GET /api/labs/current': () => Response.json(lab()),
      'GET /api/labs': () => Response.json([lab()]),
      'GET /api/modules': () => Response.json([catalogModule({ missions: [missionCard()] })]),
      [`GET /api/labs/${labId}`]: () => Response.json(lab()),
      [`GET /api/labs/${labId}/history?after=0&limit=500`]: () =>
        Response.json({
          entries: [{ seq: 1, command: 'ls -l', recorded_at: '2026-09-30T12:01:00Z' }],
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

  it('names the lab page buttons by their text, with their states', async () => {
    renderAt(`/labs/${labId}`)
    await screen.findByRole('button', { name: 'Copiar' })

    expect(names()).toEqual(
      expect.arrayContaining([
        'Desconectar',
        'Reiniciar laboratório',
        'Encerrar laboratório',
        'Verificar',
        'Copiar',
        'Inserir no terminal',
      ]),
    )
    const switcher = screen.getByRole('group', { name: 'Área do laboratório' })
    expect(within(switcher).getByRole('button', { name: 'Terminal', pressed: true })).toBeTruthy()
    expect(within(switcher).getByRole('button', { name: 'Critérios', pressed: false })).toBeTruthy()

    // The confirmation: its buttons by name, and the reset button disabled meanwhile.
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar laboratório' }))
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancelar', 'Descartar e reiniciar'])
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(
      (screen.getByRole('button', { name: 'Reiniciar laboratório' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    names()
  })

  it('names the hints by their own text and keeps their open state', async () => {
    renderAt('/missions/sample-file')
    const hint = (await screen.findByText('Dica 1')).closest('summary')
    expect(hint?.textContent).toBe('Dica 1')
    const details = hint?.closest('details')
    expect(details?.open).toBe(false)
    fireEvent.click(hint as HTMLElement)
    await waitFor(() => expect(details?.open).toBe(true))
  })

  it('names the home page buttons by their text', async () => {
    renderAt('/')
    await screen.findByRole('button', { name: 'Encerrar laboratório' })

    expect(names()).toEqual(expect.arrayContaining(['Encerrar laboratório', 'Sair']))
  })
})
