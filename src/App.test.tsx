// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ana, api, apiError, lab, labId, renderAt, signedOut } from './testSupport.tsx'

// The pages are tested with a stand-in terminal; the real one is covered by Terminal.test.tsx.
vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function signedIn(current: ReturnType<typeof lab> | null = null) {
  api.routes['GET /api/auth/me'] = () => Response.json(ana)
  api.routes['GET /api/labs/current'] = () => Response.json(current)
  api.routes['GET /api/labs'] = () => Response.json(current ? [current] : [])
}

beforeEach(() => {
  api.routes = { 'GET /api/auth/me': signedOut }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

describe('entry page', () => {
  it('shows loading while the session is checked', () => {
    api.routes['GET /api/auth/me'] = () => new Promise<Response>(() => {})
    renderAt('/')

    expect(screen.getByRole('status').textContent).toBe('Carregando…')
  })

  it('offers login and sign-up when signed out', async () => {
    renderAt('/')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toBeTruthy()
    expect(api.calls('GET', '/api/labs/current')).toBe(0)
  })

  it('greets the signed-in user and logs out', async () => {
    signedIn()
    api.routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 })
    renderAt('/')

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(api.fetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it('reports a failed session check and retries', async () => {
    api.routes['GET /api/auth/me'] = apiError(500, 'internal_error', 'Erro interno.')
    renderAt('/')

    expect((await screen.findByRole('alert')).textContent).toBe('Erro interno.')
    signedIn()
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

  it('no longer opens a terminal from ?lab=', async () => {
    renderAt(`/?lab=${labId}`)

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it('sends unknown paths to the entry page', async () => {
    renderAt('/nowhere')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
  })
})

describe('lab on the entry page', () => {
  it('starts a lab and opens its terminal', async () => {
    signedIn(null)
    api.routes['POST /api/labs'] = () => Response.json(lab(), { status: 201 })
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab())
    renderAt('/')

    expect(await screen.findByText('Nenhum laboratório ativo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar laboratório' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(labId)
    const [, init] =
      api.fetch.mock.calls.find(([path, init]) => path === '/api/labs' && init?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({})
  })

  it('links to the terminal of a ready lab and ends it', async () => {
    signedIn(lab())
    api.routes[`DELETE /api/labs/${labId}`] = () => {
      signedIn(null)
      return Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x' }))
    }
    renderAt('/')

    const link = await screen.findByRole('link', { name: 'Abrir terminal' })
    expect(link.getAttribute('href')).toBe(`/labs/${labId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar laboratório' }))

    expect(await screen.findByText('Nenhum laboratório ativo.')).toBeTruthy()
    expect(api.calls('DELETE', `/api/labs/${labId}`)).toBe(1)
  })

  it('shows a lab that is being prepared', async () => {
    signedIn(lab({ status: 'provisioning' }))
    renderAt('/')

    expect(await screen.findByText('Preparando o laboratório…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iniciar laboratório' })).toBeNull()
  })

  it('shows why the user cannot start a lab', async () => {
    signedIn(null)
    api.routes['POST /api/labs'] = apiError(
      503,
      'lab_capacity_reached',
      'Todos os laboratórios estão em uso. Tente novamente em alguns minutos.',
    )
    renderAt('/')

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Todos os laboratórios estão em uso. Tente novamente em alguns minutos.',
    )
  })

  it('lists previous labs with why they ended', async () => {
    signedIn(null)
    api.routes['GET /api/labs'] = () =>
      Response.json([
        lab({ id: 'a', status: 'terminated', end_reason: 'oom', ended_at: 'x' }),
        lab({ id: 'b', status: 'terminated', end_reason: 'logout', ended_at: 'x' }),
      ])
    renderAt('/')

    expect(await screen.findByText(/excedeu o limite de memória/)).toBeTruthy()
    expect(screen.getByText(/quando você saiu da conta/)).toBeTruthy()
  })
})

describe('login page', () => {
  it('signs in and goes to the entry page', async () => {
    api.routes['POST /api/auth/login'] = () => {
      signedIn()
      return Response.json(ana)
    }
    renderAt('/login')

    type(/Email/, 'ana@example.com')
    type(/Senha/, 'synthetic password 01')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    const [, init] = api.fetch.mock.calls.find(([path]) => path === '/api/auth/login') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ana@example.com',
      password: 'synthetic password 01',
    })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('shows the error message from the API', async () => {
    api.routes['POST /api/auth/login'] = apiError(
      401,
      'invalid_credentials',
      'Email ou senha incorretos.',
    )
    renderAt('/login')

    type(/Email/, 'ana@example.com')
    type(/Senha/, 'wrong password 01')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Email ou senha incorretos.')
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy()
  })

  it('sends a signed-in user to the entry page', async () => {
    signedIn()
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
    api.routes['POST /api/auth/signup'] = () => {
      signedIn()
      return Response.json(ana, { status: 201 })
    }
    renderAt('/signup')

    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    const [, init] = api.fetch.mock.calls.find(([path]) => path === '/api/auth/signup') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ana@example.com',
      password: 'synthetic password 01',
      display_name: 'Ana',
      invite_code: 'synthetic-invite',
    })
  })

  it('shows the error message from the API', async () => {
    api.routes['POST /api/auth/signup'] = apiError(
      403,
      'invalid_invite_code',
      'Código de convite inválido.',
    )
    renderAt('/signup')

    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Código de convite inválido.')
  })
})
