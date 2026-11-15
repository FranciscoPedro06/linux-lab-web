// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lab } from './lab/api.ts'
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

// The pages are tested with a stand-in terminal; the real one is covered by Terminal.test.tsx.
vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

const bia = { id: '0b8f5d1e-2c4a-4b1d-8e6f-1a3b3f0c2e22', email: 'bia@example.com', display_name: 'Bia' }
const historyRoute = `GET /api/labs/${labId}/history?after=0&limit=500`

// The top bar is the page's first header; the mission page has a header of its own below it.
function bar(): HTMLElement {
  const first = screen.getAllByRole('banner')[0]
  if (!first) throw new Error('no top bar')
  return first
}

async function findBar(): Promise<HTMLElement> {
  await screen.findAllByRole('banner')
  return bar()
}

// Requests other than the session check.
function otherRequests(): string[] {
  return api.fetch.mock.calls
    .map(([input, init]) => `${init?.method ?? 'GET'} ${input}`)
    .filter((request) => request !== 'GET /api/auth/me')
}

function signedIn(current: Lab | null) {
  api.routes['GET /api/auth/me'] = () => Response.json(ana)
  api.routes['GET /api/labs/current'] = () => Response.json(current)
  api.routes['GET /api/labs'] = () => Response.json(current ? [current] : [])
  api.routes['GET /api/modules'] = () => Response.json([])
}

beforeEach(() => {
  api.routes = { 'GET /api/auth/me': signedOut }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a visitor', () => {
  it.each(['/', '/login', '/signup'])('sees the public links on %s and sends nothing else', async (path) => {
    renderAt(path)

    const links = within(await findBar()).findByRole('navigation', { name: 'Conta' })
    const nav = await links
    expect(within(nav).getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/login')
    expect(within(nav).getByRole('link', { name: 'Criar conta' }).getAttribute('href')).toBe('/signup')
    expect(within(bar()).getByRole('link', { name: 'Linux Lab' }).getAttribute('href')).toBe('/')
    expect(bar().textContent).not.toMatch(/laboratório/i)
    expect(otherRequests()).toEqual([])
  })

  it('marks the current page among the public links', async () => {
    renderAt('/login')

    const nav = await within(await findBar()).findByRole('navigation', { name: 'Conta' })
    expect(within(nav).getByRole('link', { name: 'Entrar' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Criar conta' }).getAttribute('aria-current')).toBeNull()
  })

  it('has the public links only in the bar on the home page', async () => {
    renderAt('/')

    await within(await findBar()).findByRole('navigation', { name: 'Conta' })
    expect(screen.getAllByRole('link', { name: 'Entrar' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Criar conta' })).toHaveLength(1)
  })

  it('is sent from a private page to login without a lab request', async () => {
    renderAt(`/labs/${labId}`)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
    await within(bar()).findByRole('navigation', { name: 'Conta' })
    expect(otherRequests()).toEqual([])
  })
})

describe('while the session is checked', () => {
  it('shows only the name and sends no lab request', async () => {
    api.routes['GET /api/auth/me'] = () => new Promise<Response>(() => {})
    renderAt('/')

    const top = await findBar()
    expect(within(top).getByRole('link', { name: 'Linux Lab' })).toBeTruthy()
    expect(within(top).queryByRole('navigation')).toBeNull()
    expect(top.textContent).toBe('linuxlabLinux Lab')
    expect(otherRequests()).toEqual([])
  })

  it('sends no lab request when the check failed', async () => {
    api.routes['GET /api/auth/me'] = apiError(500, 'internal_error', 'Erro interno.')
    renderAt('/')

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(bar().textContent).toBe('linuxlabLinux Lab')
    expect(otherRequests()).toEqual([])
  })
})

describe('a signed-in user', () => {
  it('without a lab sees their name and no active lab', async () => {
    signedIn(null)
    renderAt('/')

    const top = await findBar()
    expect(await within(top).findByText('sem laboratório ativo')).toBeTruthy()
    expect(within(top).getByText('Ana')).toBeTruthy()
    expect(within(top).queryByRole('navigation')).toBeNull()
  })

  it('with a ready lab sees its state and how long ago it was created', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T13:42:30Z'))
    signedIn(lab({ created_at: '2026-09-30T12:00:00Z' }))
    renderAt('/')

    const link = await within(await findBar()).findByRole('link', { name: /laboratório pronto/ })
    expect(link.getAttribute('href')).toBe(`/labs/${labId}`)
    expect(link.textContent).toBe('laboratório pronto · aberto há 1h 42min')
    expect(within(link).getByText('1h 42min').getAttribute('datetime')).toBe('2026-09-30T12:00:00Z')
  })

  it('shows minutes alone under an hour, and never a negative time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T12:07:59Z'))
    signedIn(lab({ status: 'provisioning', created_at: '2026-09-30T12:00:00Z' }))
    const first = renderAt('/')

    const link = await within(await findBar()).findByRole('link', { name: /laboratório preparando/ })
    expect(link.textContent).toBe('laboratório preparando · aberto há 7min')
    first.unmount()

    // This computer's clock is behind the API's.
    vi.setSystemTime(new Date('2026-09-30T11:59:00Z'))
    signedIn(lab({ created_at: '2026-09-30T12:00:00Z' }))
    renderAt('/')
    const ready = await within(await findBar()).findByRole('link', { name: /laboratório pronto/ })
    expect(ready.textContent).toBe('laboratório pronto · aberto há 0min')
  })

  it('shows a lab being ended without a time', async () => {
    signedIn(lab({ status: 'terminating' }))
    renderAt('/')

    const link = await within(await findBar()).findByRole('link', { name: /laboratório encerrando/ })
    expect(link.textContent).toBe('laboratório encerrando')
  })

  it('says it is checking while the current lab loads', async () => {
    signedIn(null)
    api.routes['GET /api/labs/current'] = () => new Promise<Response>(() => {})
    renderAt('/')

    expect(await within(await findBar()).findByText('verificando laboratório…')).toBeTruthy()
  })

  it('says the state is unknown when the current lab cannot be read', async () => {
    signedIn(null)
    api.routes['GET /api/labs/current'] = apiError(500, 'internal_error', 'Erro interno.')
    renderAt('/')

    const top = await findBar()
    expect(await within(top).findByText('estado do laboratório indisponível')).toBeTruthy()
    // The page reports the failure; the bar does not announce it again.
    expect(within(top).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Erro interno.')
  })

  it('asks once for the current lab on the home page, shared with its panel', async () => {
    signedIn(lab())
    renderAt('/')

    await within(await findBar()).findByRole('link', { name: /laboratório pronto/ })
    expect(await screen.findByRole('link', { name: 'Abrir terminal' })).toBeTruthy()
    expect(api.calls('GET', '/api/labs/current')).toBe(1)
  })

  it('asks once for the current lab on the mission page, shared with the page', async () => {
    signedIn(lab())
    api.routes['GET /api/missions/sample-file'] = () => Response.json(missionDetail())
    renderAt('/missions/sample-file')

    await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })
    await within(bar()).findByRole('link', { name: /laboratório pronto/ })
    expect(api.calls('GET', '/api/labs/current')).toBe(1)
  })
})

describe('the lab page', () => {
  beforeEach(() => {
    signedIn(lab())
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab())
    api.routes[historyRoute] = () => Response.json({ entries: [], more: false })
  })

  it('puts the mission and the connection in the bar and keeps the lab controls', async () => {
    renderAt(`/labs/${labId}`)

    expect(await screen.findByTestId('terminal')).toBeTruthy()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    const top = bar()
    expect(within(top).getByText('Ana')).toBeTruthy()
    expect(within(top).getByRole('link', { name: 'Arquivo de teste' }).getAttribute('href')).toBe(
      '/missions/sample-file',
    )
    expect(within(top).getByRole('status').textContent).toMatch(/^Estado: /)
    expect(within(top).getByRole('link', { name: /laboratório pronto/ }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratório' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reiniciar laboratório' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Encerrar laboratório' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Verificação' })).toBeTruthy()
  })

  it('shows the lab it holds instead of asking for the current lab', async () => {
    renderAt(`/labs/${labId}`)

    // The page's states are different components, each with its bar: read it once ready.
    expect(await screen.findByTestId('terminal')).toBeTruthy()
    expect(within(bar()).getByRole('link', { name: /laboratório pronto/ })).toBeTruthy()
    expect(api.calls('GET', '/api/labs/current')).toBe(0)
  })

  it('shows a lab being prepared without asking for the current lab', async () => {
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab({ status: 'provisioning' }))
    renderAt(`/labs/${labId}`)

    expect(await screen.findByText('Preparando o laboratório…')).toBeTruthy()
    expect(within(bar()).getByRole('link', { name: /laboratório preparando/ })).toBeTruthy()
    expect(api.calls('GET', '/api/labs/current')).toBe(0)
  })

  it('asks for the current lab once the lab shown has ended', async () => {
    const ended = lab({ status: 'terminated', end_reason: 'user', ended_at: '2026-09-30T13:00:00Z' })
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(ended)
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    renderAt(`/labs/${labId}`)

    expect(await screen.findByText('Você encerrou o laboratório.')).toBeTruthy()
    expect(await within(bar()).findByText('sem laboratório ativo')).toBeTruthy()
    expect(api.calls('GET', '/api/labs/current')).toBe(1)
  })

  it('shows the current lab on a lab that does not exist', async () => {
    api.routes[`GET /api/labs/${labId}`] = apiError(404, 'lab_not_found', 'Laboratório não encontrado.')
    renderAt(`/labs/${labId}`)

    expect(await screen.findByText('Laboratório não encontrado.')).toBeTruthy()
    expect(await within(bar()).findByRole('link', { name: /laboratório pronto/ })).toBeTruthy()
  })

  it('keeps one bar while the lab loads', async () => {
    api.routes[`GET /api/labs/${labId}`] = () => new Promise<Response>(() => {})
    renderAt(`/labs/${labId}`)

    expect(await screen.findByText('Carregando o laboratório…')).toBeTruthy()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratório' })).toBeTruthy()
  })
})

describe('navigation', () => {
  it('goes from the home page to the lab and back through the bar', async () => {
    signedIn(lab())
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab())
    api.routes[historyRoute] = () => Response.json({ entries: [], more: false })
    renderAt('/')

    fireEvent.click(await within(await findBar()).findByRole('link', { name: /laboratório pronto/ }))
    expect(await screen.findByTestId('terminal')).toBeTruthy()

    fireEvent.click(within(bar()).getByRole('link', { name: 'Linux Lab' }))
    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    expect(screen.queryByTestId('terminal')).toBeNull()
    expect(await within(bar()).findByRole('link', { name: /laboratório pronto/ })).toBeTruthy()
  })
})

describe('a change of user', () => {
  it('follows logout and the next login, with nothing of the previous user', async () => {
    signedIn(lab())
    api.routes['POST /api/auth/logout'] = () => {
      api.routes['GET /api/auth/me'] = signedOut
      return new Response(null, { status: 204 })
    }
    renderAt('/')

    expect(await within(await findBar()).findByRole('link', { name: /laboratório pronto/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    // Signed out: the public links, and no lab request after the logout.
    const nav = await within(await findBar()).findByRole('navigation', { name: 'Conta' })
    const polled = api.calls('GET', '/api/labs/current')
    expect(bar().textContent).not.toContain('Ana')
    expect(bar().textContent).not.toMatch(/laboratório/i)

    fireEvent.click(within(nav).getByRole('link', { name: 'Entrar' }))
    await screen.findByRole('heading', { name: 'Entrar' })
    expect(api.calls('GET', '/api/labs/current')).toBe(polled)

    api.routes['POST /api/auth/login'] = () => {
      api.routes['GET /api/auth/me'] = () => Response.json(bia)
      return Response.json(bia)
    }
    api.routes['GET /api/labs/current'] = () => Response.json(null)
    api.routes['GET /api/labs'] = () => Response.json([])
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'bia@example.com' } })
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await screen.findByText('Olá, Bia.')
    const top = bar()
    expect(await within(top).findByText('sem laboratório ativo')).toBeTruthy()
    expect(within(top).getByText('Bia')).toBeTruthy()
    expect(top.textContent).not.toContain('Ana')
    await waitFor(() => expect(api.calls('GET', '/api/labs/current')).toBeGreaterThan(polled))
  })
})
