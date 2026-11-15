// @vitest-environment jsdom
// Interaction feedback: confirmations put Cancelar first and give the focus back, and
// buttons show the busy spinner while their request runs, from the request's own state.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ana,
  api,
  apiError,
  lab,
  labId,
  missionDetail,
  renderAt,
  signedOut,
} from './testSupport.tsx'
import indexCss from './index.css?raw'
import confirmCss from './lab/ConfirmReplace.module.css?raw'
import historyCss from './lab/HistoryPanel.module.css?raw'
import labPageCss from './lab/LabPage.module.css?raw'
import labPanelCss from './lab/LabPanel.module.css?raw'

vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

const historyRoute = `GET /api/labs/${labId}/history?after=0&limit=500`
const replacePath = `/api/labs/${labId}/replace`
const otherMission = { slug: 'sample-answer', title: 'Resposta de teste', version: 3 }

// A response the test releases when it wants.
function pending() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => {
    release = resolve
  })
  return { route: () => promise, release: (response: Response) => act(async () => release(response)) }
}

function names(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}

beforeEach(() => {
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    'GET /api/labs/current': () => Response.json(lab()),
    'GET /api/labs': () => Response.json([lab()]),
    'GET /api/modules': () => Response.json([]),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
    [historyRoute]: () => Response.json({ entries: [], more: false }),
    'GET /api/missions/sample-file': () => Response.json(missionDetail()),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

// Both places that ask before discarding a lab.
const confirmations = [
  {
    name: 'reset on the lab page',
    path: `/labs/${labId}`,
    setup: () => {},
    opener: 'Reiniciar laboratório',
    dialog: 'Reiniciar o laboratório?',
    danger: 'Descartar e reiniciar',
  },
  {
    name: 'mission switch on the mission page',
    path: '/missions/sample-file',
    setup: () => {
      api.routes['GET /api/labs/current'] = () => Response.json(lab({ mission: otherMission }))
    },
    opener: 'Trocar para esta missão',
    dialog: 'Trocar de missão?',
    danger: 'Descartar e trocar',
  },
]

describe.each(confirmations)('the confirmation of the $name', (c) => {
  beforeEach(() => c.setup())

  async function open() {
    renderAt(c.path)
    fireEvent.click(await screen.findByRole('button', { name: c.opener }))
    return screen.getByRole('alertdialog', { name: c.dialog })
  }

  it('puts Cancelar first and focuses it', async () => {
    const dialog = await open()

    expect(names(dialog)).toEqual(['Cancelar', c.danger])
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }))
  })

  it('keeps the keyboard order the same as the order on screen', async () => {
    const dialog = await open()
    const [cancel, danger] = within(dialog).getAllByRole('button')

    // No tabindex reorders them: Tab goes from Cancelar to the danger action.
    expect(cancel?.getAttribute('tabindex')).toBeNull()
    expect(danger?.getAttribute('tabindex')).toBeNull()
    expect(cancel?.compareDocumentPosition(danger as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Nor does the layout: the actions are one row in source order.
    expect(confirmCss).not.toMatch(/row-reverse|column-reverse|\border\s*:/)
  })

  it('cancels without a request and gives the focus back to the button that opened it', async () => {
    const dialog = await open()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: c.opener })),
    )
    expect(api.calls('POST', replacePath)).toBe(0)
  })

  it('sends the request once, however often the action is pressed', async () => {
    const replaced = pending()
    api.routes[`POST ${replacePath}`] = replaced.route
    const dialog = await open()
    const danger = within(dialog).getByRole('button', { name: c.danger })

    fireEvent.click(danger)
    fireEvent.click(danger)
    fireEvent.click(danger)

    await waitFor(() => expect(api.calls('POST', replacePath)).toBe(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('busy buttons', () => {
  it('validation: busy while it runs, once however often pressed, back to normal after', async () => {
    const validation = pending()
    api.routes[`POST /api/labs/${labId}/validate`] = validation.route
    renderAt(`/labs/${labId}`)

    const button = await screen.findByRole('button', { name: 'Verificar' })
    expect(button.getAttribute('aria-busy')).toBeNull()
    fireEvent.click(button)
    fireEvent.click(button)

    const busy = await screen.findByRole('button', { name: 'Verificando…' })
    expect(busy).toBe(button)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.hasAttribute('disabled')).toBe(true)
    fireEvent.click(busy)
    expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1)

    await validation.release(
      Response.json({
        run_id: 1,
        outcome: 'failed',
        newly_completed: false,
        mission: { slug: 'sample-file', version: 1 },
        progress: { status: 'not_completed', completed_version: null, completed_at: null },
        result: null,
      }),
    )
    const done = await screen.findByRole('button', { name: 'Verificar' })
    expect(done.getAttribute('aria-busy')).toBeNull()
    expect(done.hasAttribute('disabled')).toBe(false)

    // Once settled, the next press is a new request.
    fireEvent.click(done)
    await waitFor(() => expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(2))
  })

  it('ending the lab: busy while it runs and back to normal after an error', async () => {
    const ended = pending()
    api.routes[`DELETE /api/labs/${labId}`] = ended.route
    renderAt(`/labs/${labId}`)

    const button = await screen.findByRole('button', { name: 'Encerrar laboratório' })
    fireEvent.click(button)
    fireEvent.click(button)

    const busy = await screen.findByRole('button', { name: 'Encerrando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(api.calls('DELETE', `/api/labs/${labId}`)).toBe(1)

    await ended.release(
      Response.json({ error: { code: 'internal_error', message: 'Erro interno.' } }, { status: 500 }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe('Erro interno.')
    const again = screen.getByRole('button', { name: 'Encerrar laboratório' })
    expect(again.getAttribute('aria-busy')).toBeNull()
    expect(again.hasAttribute('disabled')).toBe(false)
  })

  it('ending the lab from the home page, a button without brackets', async () => {
    const ended = pending()
    api.routes[`DELETE /api/labs/${labId}`] = ended.route
    renderAt('/')

    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar laboratório' }))

    const busy = await screen.findByRole('button', { name: 'Encerrando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    await ended.release(Response.json(lab({ status: 'terminating' })))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Encerrando…' })).toBeNull())
  })

  it('starting a new lab after one ended: busy until the API answers', async () => {
    const ended = lab({ status: 'terminated', end_reason: 'user', ended_at: '2026-09-30T13:00:00Z' })
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(ended)
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    const created = pending()
    api.routes['POST /api/labs'] = created.route
    renderAt(`/labs/${labId}`)

    const button = await screen.findByRole('button', { name: 'Iniciar novo laboratório' })
    fireEvent.click(button)
    fireEvent.click(button)

    const busy = await screen.findByRole('button', { name: 'Preparando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(api.calls('POST', '/api/labs')).toBe(1)

    await created.release(
      Response.json(
        { error: { code: 'lab_capacity_reached', message: 'Sem capacidade.' } },
        { status: 503 },
      ),
    )
    const again = await screen.findByRole('button', { name: 'Iniciar novo laboratório' })
    expect(again.getAttribute('aria-busy')).toBeNull()
  })

  it('starting a lab from the mission page: the waiting button is busy', async () => {
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    const created = pending()
    api.routes['POST /api/labs'] = created.route
    renderAt('/missions/sample-file')

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    const busy = await screen.findByRole('button', { name: 'Preparando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.hasAttribute('disabled')).toBe(true)
    await created.release(
      Response.json({ error: { code: 'lab_start_failed', message: 'Falhou.' } }, { status: 500 }),
    )
    expect(await screen.findByRole('button', { name: 'Iniciar laboratório' })).toBeTruthy()
    expect(screen.queryByRole('button', { busy: true })).toBeNull()
  })

  it('switching missions: the waiting button is busy', async () => {
    api.routes['GET /api/labs/current'] = () => Response.json(lab({ mission: otherMission }))
    api.routes[`POST ${replacePath}`] = pending().route
    renderAt('/missions/sample-file')

    fireEvent.click(await screen.findByRole('button', { name: 'Trocar para esta missão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e trocar' }))

    const busy = await screen.findByRole('button', { name: 'Trocando de missão…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
  })

  it('login: busy while it runs and back to normal after an error', async () => {
    api.routes['GET /api/auth/me'] = signedOut
    const login = pending()
    api.routes['POST /api/auth/login'] = login.route
    renderAt('/login')

    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'ana@example.com' } })
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    const busy = await screen.findByRole('button', { name: 'Entrando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await login.release(
      Response.json({ error: { code: 'invalid_credentials', message: 'Email ou senha incorretos.' } }, { status: 401 }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe('Email ou senha incorretos.')
    expect(screen.getByRole('button', { name: 'Entrar' }).getAttribute('aria-busy')).toBeNull()
  })

  it('logout: busy while it runs', async () => {
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    api.routes['GET /api/labs'] = () => Response.json([])
    const logout = pending()
    api.routes['POST /api/auth/logout'] = logout.route
    renderAt('/')

    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))

    // While the session changes the page is hidden (auth/tabs.tsx); the button is busy under it.
    const busy = await screen.findByRole('button', { name: 'Saindo…', hidden: true })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    api.routes['GET /api/auth/me'] = signedOut
    await logout.release(new Response(null, { status: 204 }))
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
  })

  it('is never busy without a request', async () => {
    renderAt(`/labs/${labId}`)

    expect(await screen.findByTestId('terminal')).toBeTruthy()
    expect(screen.queryByRole('button', { busy: true })).toBeNull()
  })

  it('reports a failure to the page, not as a busy button', async () => {
    api.routes[`POST /api/labs/${labId}/validate`] = apiError(500, 'internal_error', 'Erro interno.')
    renderAt(`/labs/${labId}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { busy: true })).toBeNull()
  })
})

// The spinner itself is CSS; jsdom does not compute generated content, so its rules are
// checked here and its rendering in a browser.
describe('the spinner', () => {
  const css = indexCss
  const frames = ["'| '", "'/ '", "'- '", "'\\\\ '"]

  it('turns through | / - \\ in steps, only on busy buttons', () => {
    expect(css).toMatch(/button\[aria-busy='true'\]::before \{[^}]*animation: busy [^;]*steps\(1\) infinite;/)
    const keyframes = css.slice(css.indexOf('@keyframes busy'))
    for (const frame of frames) expect(keyframes).toContain(`var(--open) ${frame} / ''`)
  })

  it('is hidden from screen readers: every frame has empty alternative text', () => {
    const contents: string[] = css.match(/content: var\(--open\) '[^']*'[^;]*;/g) ?? []
    const withAlt = contents.filter((line) => line.endsWith("/ '';"))
    // Each frame and the static rule: once without alternative text (older browsers), once with.
    expect(withAlt).toHaveLength(frames.length + 1)
    expect(contents).toHaveLength(2 * (frames.length + 1))
  })

  it('stops under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*button\[aria-busy='true'\]::before \{\s*animation: none;/,
    )
  })

  it('has no brackets on buttons that have none', () => {
    expect(css).toMatch(/button\[type='submit'\] \{\s*--open: '';/)
    for (const file of [labPageCss, labPanelCss, historyCss]) {
      expect(file).toMatch(/\.(primary|inline) \{\s*--open: '';/)
    }
  })
})
