// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'

// The page is tested with a stand-in terminal; the real one is covered by Terminal.test.tsx.
vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ labId, closeRequested }: { labId: string; closeRequested: boolean }) => (
    <div data-testid="terminal">
      {labId} {closeRequested ? 'close requested' : 'open'}
    </div>
  ),
}))

const ana = { id: '7d0e0c43-3f5a-4a53-9d1a-1a3b3f0c2e11', email: 'ana@example.com', display_name: 'Ana' }

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

// A fake API: each test sets the replies for the routes it uses.
let routes: Record<string, Route>
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const route = routes[`${init?.method ?? 'GET'} ${input}`]
  if (!route) throw new Error(`unexpected request ${init?.method} ${input}`)
  return route(init)
})

const signedOut: Route = () =>
  Response.json({ error: { code: 'not_authenticated', message: 'Sessão inválida.' } }, { status: 401 })

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  routes = { 'GET /api/auth/me': signedOut }
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  fetchMock.mockClear()
  vi.unstubAllGlobals()
})

describe('entry page', () => {
  it('shows loading while the session is checked', () => {
    routes['GET /api/auth/me'] = () => new Promise<Response>(() => {})
    renderAt('/')

    expect(screen.getByRole('status').textContent).toBe('Carregando…')
  })

  it('offers login and sign-up when signed out', async () => {
    renderAt('/')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toBeTruthy()
  })

  it('greets the signed-in user and logs out', async () => {
    routes['GET /api/auth/me'] = () => Response.json(ana)
    routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 })
    renderAt('/')

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it('reports a failed session check and retries', async () => {
    routes['GET /api/auth/me'] = () =>
      Response.json({ error: { code: 'internal_error', message: 'Erro interno.' } }, { status: 500 })
    renderAt('/')

    expect((await screen.findByRole('alert')).textContent).toBe('Erro interno.')
    routes['GET /api/auth/me'] = () => Response.json(ana)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
  })

  it('navigates to the login and sign-up pages', async () => {
    renderAt('/')

    fireEvent.click(await screen.findByRole('link', { name: 'Entrar' }))
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Cadastre-se/ }))
    expect(screen.getByRole('heading', { name: 'Criar conta' })).toBeTruthy()
  })
})

describe('login page', () => {
  it('signs in and goes to the entry page', async () => {
    routes['POST /api/auth/login'] = () => Response.json(ana)
    renderAt('/login')

    type(/Email/, 'ana@example.com')
    type(/Senha/, 'synthetic password 01')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    const [, init] = fetchMock.mock.calls.find(([path]) => path === '/api/auth/login') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ana@example.com',
      password: 'synthetic password 01',
    })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('shows the error message from the API', async () => {
    routes['POST /api/auth/login'] = () =>
      Response.json(
        { error: { code: 'invalid_credentials', message: 'Email ou senha incorretos.' } },
        { status: 401 },
      )
    renderAt('/login')

    type(/Email/, 'ana@example.com')
    type(/Senha/, 'wrong password 01')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Email ou senha incorretos.')
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy()
  })

  it('sends a signed-in user to the entry page', async () => {
    routes['GET /api/auth/me'] = () => Response.json(ana)
    renderAt('/login')

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
  })
})

describe('sign-up page', () => {
  function fill() {
    type(/Nome/, 'Ana')
    type(/Email/, 'ana@example.com')
    type(/^Senha/, 'synthetic password 01')
    type(/Código de convite/, 'synthetic-invite')
  }

  it('creates the account and goes to the entry page', async () => {
    routes['POST /api/auth/signup'] = () => Response.json(ana, { status: 201 })
    renderAt('/signup')

    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    const [, init] = fetchMock.mock.calls.find(([path]) => path === '/api/auth/signup') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ana@example.com',
      password: 'synthetic password 01',
      display_name: 'Ana',
      invite_code: 'synthetic-invite',
    })
  })

  it('shows the error message from the API', async () => {
    routes['POST /api/auth/signup'] = () =>
      Response.json(
        { error: { code: 'invalid_invite_code', message: 'Código de convite inválido.' } },
        { status: 403 },
      )
    renderAt('/signup')

    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Código de convite inválido.')
  })
})

describe('development terminal', () => {
  it('opens the lab terminal from ?lab= without an account', () => {
    renderAt('/?lab=abc')

    expect(screen.getByTestId('terminal').textContent).toBe('abc open')
    expect(screen.getByRole('status').textContent).toContain('Conectando')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Reiniciar/ }).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }))
    expect(screen.getByTestId('terminal').textContent).toBe('abc close requested')
  })

  it('sends unknown paths to the entry page', async () => {
    renderAt('/nowhere')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
  })
})
