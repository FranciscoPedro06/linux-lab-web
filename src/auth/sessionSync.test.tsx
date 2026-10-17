// @vitest-environment jsdom
// The session cookie is shared by every tab. When another tab changes who is signed
// in, this tab must stop showing the previous user's data and never show it again
// under the new user, with or without BroadcastChannel.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModule, MissionDetail } from '../catalog/api.ts'
import {
  ana,
  api,
  apiError,
  catalogModule,
  completed,
  lab,
  labId,
  missionCard,
  missionDetail,
  renderAt,
  signedOut,
} from '../testSupport.tsx'
import { SESSION_CHECK_MS, TRANSITION_TIMEOUT_MS } from './session.ts'

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: () => <div data-testid="terminal" />,
}))

const bia = { id: '0b8f5d1e-2c4a-4b1d-8e6f-1a3b3f0c2e22', email: 'bia@example.com', display_name: 'Bia' }
const anaCatalog = () => [catalogModule({ missions: [missionCard({ progress: completed() })] })]
const biaCatalog = () => [catalogModule({ missions: [missionCard()] })]

function pending() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => (release = resolve))
  return { route: () => promise, release }
}

// Another tab of the same browser.
function otherTab() {
  const channel = new BroadcastChannel('linux-lab-session')
  return {
    post: (message: string) => channel.postMessage(message),
    close: () => channel.close(),
  }
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
}

// Ana's home page, with her completed mission in the catalog.
async function anaHome() {
  api.routes['GET /api/modules'] = () => Response.json(anaCatalog())
  const { client } = renderAt('/')
  await screen.findByText('Olá, Ana.')
  await within(screen.getByRole('region', { name: 'Missões' })).findByText('Concluída')
  return client
}

function privateShown(): boolean {
  return screen.queryByRole('region', { name: 'Missões' }) !== null
}

// Who is signed in is now Bia, with her own catalog; her session check waits.
function cookieIsNowBias() {
  const check = pending()
  api.routes['GET /api/auth/me'] = check.route
  api.routes['GET /api/modules'] = () => Response.json(biaCatalog())
  return check
}

async function biaHomeShown() {
  await screen.findByText('Olá, Bia.')
  const catalog = screen.getByRole('region', { name: 'Missões' })
  await within(catalog).findByRole('link', { name: 'Arquivo de teste' })
  expect(catalog.textContent).not.toContain('Concluída')
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    'GET /api/labs/current': () => Response.json(null),
    'GET /api/labs': () => Response.json([]),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
    'GET /api/missions/sample-file': () => Response.json(missionDetail()),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('another tab changes the session (BroadcastChannel)', () => {
  it('hides private pages from the start of the change until the API confirms the new user', async () => {
    const client = await anaHome()
    const tab = otherTab()

    tab.post('session-changing')
    await vi.waitFor(() => expect(privateShown()).toBe(false))
    expect(screen.queryByText('Olá, Ana.')).toBeNull()

    const check = cookieIsNowBias()
    tab.post('session-changed')
    tab.close()
    // Still hidden while the session check is in flight, and Ana's catalog is gone.
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(2))
    expect(privateShown()).toBe(false)
    expect(client.getQueryData<CatalogModule[]>(['catalog', 'modules'])).toBeUndefined()

    check.release(Response.json(bia))
    await biaHomeShown()
  })

  it('confirms the session again after a failed change before showing anything', async () => {
    await anaHome()
    const tab = otherTab()
    tab.post('session-changing')
    await vi.waitFor(() => expect(privateShown()).toBe(false))

    const check = pending()
    api.routes['GET /api/auth/me'] = check.route
    tab.post('session-unchanged')
    tab.close()
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(2))
    expect(privateShown()).toBe(false)

    check.release(Response.json(ana))
    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    await within(screen.getByRole('region', { name: 'Missões' })).findByText('Concluída')
  })

  it('leaves the transition on its own when the other tab never says how it ended', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    await anaHome()
    const tab = otherTab()
    tab.post('session-changing')
    tab.close()
    await vi.waitFor(() => expect(privateShown()).toBe(false))
    const checks = api.calls('GET', '/api/auth/me')

    await act(async () => {
      vi.advanceTimersByTime(TRANSITION_TIMEOUT_MS)
    })

    // The session is checked again, not assumed.
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(checks + 1))
    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
  })

  it('does not let an older session check bring the previous user back', async () => {
    const client = await anaHome()
    // A session check sent while Ana's cookie was still there is in flight.
    const old = pending()
    api.routes['GET /api/auth/me'] = old.route
    void client.refetchQueries({ queryKey: ['auth', 'me'] })
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(2))

    const tab = otherTab()
    tab.post('session-changing')
    const check = cookieIsNowBias()
    tab.post('session-changed')
    tab.close()
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(3))
    check.release(Response.json(bia))
    await biaHomeShown()

    // Ana's old answer arrives last.
    old.release(Response.json(ana))
    await vi.waitFor(() =>
      expect(client.getQueryState(['auth', 'me'])?.fetchStatus).toBe('idle'),
    )
    await act(async () => {})
    expect(screen.queryByText('Olá, Ana.')).toBeNull()
    expect(screen.getByText('Olá, Bia.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Missões' }).textContent).not.toContain('Concluída')
  })

  it("does not write Ana's late validation into Bia's cache after another tab changed the session", async () => {
    const validation = pending()
    api.routes[`POST /api/labs/${labId}/validate`] = validation.route
    const { client } = renderAt(`/labs/${labId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await vi.waitFor(() => expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1))

    const tab = otherTab()
    tab.post('session-changing')
    api.routes['GET /api/auth/me'] = () => Response.json(bia)
    api.routes['GET /api/modules'] = () => Response.json(biaCatalog())
    api.routes[`GET /api/labs/${labId}`] = apiError(404, 'lab_not_found', 'Laboratório não encontrado.')
    tab.post('session-changed')
    tab.close()
    // Bia's tab now: the lab is not hers; she opens her home page and the mission.
    fireEvent.click(await screen.findByRole('link', { name: 'Linux Lab' }))
    await biaHomeShown()
    fireEvent.click(screen.getByRole('link', { name: 'Arquivo de teste' }))
    await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })
    const before = {
      modules: client.getQueryData<CatalogModule[]>(['catalog', 'modules']),
      detail: client.getQueryData<MissionDetail>(['catalog', 'mission', 'sample-file']),
    }
    expect(before.detail?.progress.status).toBe('not_completed')

    validation.release(
      Response.json({
        run_id: 1,
        outcome: 'passed',
        newly_completed: true,
        mission: { slug: 'sample-file', version: 1 },
        progress: completed(),
        result: null,
      }),
    )
    await vi.waitFor(() => expect(client.isMutating()).toBe(0))
    await act(async () => {})

    expect(client.getQueryData(['catalog', 'modules'])).toEqual(before.modules)
    expect(client.getQueryData(['catalog', 'mission', 'sample-file'])).toEqual(before.detail)
    expect(screen.getByRole('banner').textContent).not.toContain('Concluída')
  })
})

describe('this tab tells the others', () => {
  async function signIn(answer: () => Response) {
    const messages: unknown[] = []
    const tab = new BroadcastChannel('linux-lab-session')
    tab.onmessage = (event) => messages.push(event.data)
    api.routes['GET /api/auth/me'] = signedOut
    api.routes['GET /api/modules'] = () => Response.json(biaCatalog())
    api.routes['POST /api/auth/login'] = answer
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'bia@example.com' } })
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    return { messages, close: () => tab.close() }
  }

  it('before the login is sent and once it succeeded', async () => {
    const { messages, close } = await signIn(() => {
      api.routes['GET /api/auth/me'] = () => Response.json(bia)
      return Response.json(bia)
    })
    await screen.findByText('Olá, Bia.')
    await vi.waitFor(() => expect(messages).toEqual(['session-changing', 'session-changed']))
    close()
  })

  it('before the login is sent and once it failed', async () => {
    const { messages, close } = await signIn(() =>
      Response.json(
        { error: { code: 'invalid_credentials', message: 'Email ou senha incorretos.' } },
        { status: 401 },
      ),
    )
    await screen.findByText('Email ou senha incorretos.')
    await vi.waitFor(() => expect(messages).toEqual(['session-changing', 'session-unchanged']))
    close()
  })
})

describe('without BroadcastChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  it('hides private pages when the tab becomes visible until the API says who is signed in', async () => {
    const client = await anaHome()
    setVisibility('hidden')
    // Meanwhile, Bia signed in in another tab.
    const check = cookieIsNowBias()
    const catalogs = api.calls('GET', '/api/modules')

    setVisibility('visible')

    await vi.waitFor(() => expect(privateShown()).toBe(false))
    expect(screen.queryByText('Olá, Ana.')).toBeNull()
    check.release(Response.json(bia))
    await biaHomeShown()
    // Bia's catalog was fetched for her, not reused. (The library also refetches stale
    // queries when the tab becomes visible; that answer is never shown, since private
    // pages are hidden, and is dropped when the session check names another user.)
    expect(api.calls('GET', '/api/modules')).toBeGreaterThan(catalogs)
    expect(client.getQueryData<CatalogModule[]>(['catalog', 'modules'])).toEqual(biaCatalog())
  })

  it('checks the session of a tab that stays visible and drops the previous user data', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await anaHome()
    // Bia signed in in a window next to this one; this tab never lost visibility.
    api.routes['GET /api/auth/me'] = () => Response.json(bia)
    api.routes['GET /api/modules'] = () => Response.json(biaCatalog())

    act(() => {
      vi.advanceTimersByTime(SESSION_CHECK_MS)
    })

    await biaHomeShown()
  })

  it('still works normally for the signed-in user', async () => {
    await anaHome()
    setVisibility('hidden')
    setVisibility('visible')
    expect(await screen.findByText('Olá, Ana.')).toBeTruthy()
    await within(screen.getByRole('region', { name: 'Missões' })).findByText('Concluída')
  })
})
