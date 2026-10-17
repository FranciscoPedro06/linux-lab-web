// @vitest-environment jsdom
// Tabs of one browser share the session cookie. A login, sign-up or logout may only
// change it once no tab shows private pages, and every tab asks the API who is signed
// in before showing them again (auth/tabs.tsx). Two apps rendered in one test act as
// two tabs: they share the BroadcastChannel and the lock manager (testLocks.ts).
import { act, cleanup, fireEvent, isInaccessible, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModule } from '../catalog/api.ts'
import {
  ana,
  api,
  apiError,
  catalogModule,
  completed,
  lab,
  labId,
  locks,
  missionCard,
  missionDetail,
  renderAt,
  signedOut,
} from '../testSupport.tsx'
import type { User } from './api.ts'
import { COORDINATION_TIMEOUT_MS, RECOVERY_MS } from './tabs.tsx'

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: () => <div data-testid="terminal" />,
}))

const LOCK = 'linux-lab-session'
const bia: User = { id: '0b8f5d1e-2c4a-4b1d-8e6f-1a3b3f0c2e22', email: 'bia@example.com', display_name: 'Bia' }
const BUSY = 'Outra aba do Linux Lab não liberou a sessão. Feche ou atualize as outras abas e tente novamente.'
const UNSUPPORTED =
  'Este navegador não permite trocar de conta com segurança entre abas. Atualize o navegador para entrar.'

// The API: who the shared cookie belongs to, and each user's catalog.
const server = { user: ana as User | null }

// A route that answers when the test releases it; every request waiting on it gets its
// own response, built from the same answer.
function pending() {
  let release!: (answer: () => Response) => void
  const answer = new Promise<() => Response>((resolve) => (release = resolve))
  return { route: () => answer.then((make) => make()), release }
}

// A tab: an app rendered in its own container with its own query client.
function openTab(path: string, options: { strict?: boolean } = {}) {
  const { container, client } = renderAt(path, options)
  const tab = within(container as HTMLElement)
  return {
    client,
    tab,
    // Whether this tab shows private pages (hidden ones are not accessible).
    showsCatalog: () => tab.queryByRole('region', { name: 'Missões' }) !== null,
    catalogText: () => tab.queryByRole('region', { name: 'Missões' })?.textContent ?? '',
  }
}

async function signInAsBia(tab: ReturnType<typeof openTab>) {
  await tab.tab.findByRole('heading', { name: 'Entrar' })
  fireEvent.change(tab.tab.getByLabelText(/Email/), { target: { value: 'bia@example.com' } })
  fireEvent.change(tab.tab.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
  fireEvent.click(tab.tab.getByRole('button', { name: 'Entrar' }))
}

// Another tab, played by the test: it can hold the lock and post messages.
function otherTab() {
  const channel = new BroadcastChannel('linux-lab-session')
  const messages: unknown[] = []
  channel.onmessage = (event) => messages.push(event.data)
  let releaseLock: (() => void) | undefined
  return {
    messages,
    post: (message: string) => channel.postMessage(message),
    // Holds the lock in `mode` until release() is called; resolves once granted.
    hold: (mode: 'shared' | 'exclusive') =>
      new Promise<void>((granted) => {
        void locks.request(LOCK, { mode }, () => {
          granted()
          return new Promise<void>((released) => (releaseLock = released))
        })
      }),
    release: () => releaseLock?.(),
    close: () => {
      releaseLock?.()
      channel.close()
    },
  }
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  server.user = ana
  api.routes = {
    'GET /api/auth/me': () => (server.user ? Response.json(server.user) : signedOut(undefined)),
    'GET /api/labs/current': () => Response.json(null),
    'GET /api/labs': () => Response.json([]),
    'GET /api/modules': (): Response =>
      Response.json(
        server.user?.id === ana.id
          ? [catalogModule({ missions: [missionCard({ progress: completed() })] })]
          : [catalogModule({ missions: [missionCard()] })],
      ),
    'GET /api/missions/sample-file': () => Response.json(missionDetail()),
    [`GET /api/labs/${labId}`]: () =>
      server.user?.id === ana.id
        ? Response.json(lab())
        : apiError(404, 'lab_not_found', 'Laboratório não encontrado.')(undefined),
    'POST /api/auth/login': () => {
      server.user = bia
      return Response.json(bia)
    },
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
})

async function anaHomeIn(tab: ReturnType<typeof openTab>) {
  await tab.tab.findByText('Olá, Ana.')
  await vi.waitFor(() => expect(tab.catalogText()).toContain('Concluída'))
}

describe('a session change waits for every visible tab', () => {
  it('sends the login only once the other visible tab hides its private pages', async () => {
    const first = openTab('/')
    await anaHomeIn(first)
    // Ana's session expired on the server; the first tab has not noticed yet.
    server.user = null
    let firstShownDuringLogin: boolean | undefined
    let holdersDuringLogin: string[] | undefined
    api.routes['POST /api/auth/login'] = () => {
      firstShownDuringLogin = first.showsCatalog()
      holdersDuringLogin = locks.holders(LOCK)
      server.user = bia
      return Response.json(bia)
    }

    const second = openTab('/login')
    await signInAsBia(second)

    await second.tab.findByText('Olá, Bia.')
    // When the cookie changed, the first tab showed nothing private and held no lock.
    expect(firstShownDuringLogin).toBe(false)
    expect(holdersDuringLogin).toEqual(['exclusive'])
    // Then it asked the API and shows Bia's own data only.
    await first.tab.findByText('Olá, Bia.')
    await vi.waitFor(() => expect(first.catalogText()).toContain('Arquivo de teste'))
    expect(first.catalogText()).not.toContain('Concluída')
  })

  it('does not send the login while a tab is slow to give up its lock', async () => {
    server.user = null
    const slow = otherTab()
    await slow.hold('shared')
    const tab = openTab('/login')
    await signInAsBia(tab)

    await vi.waitFor(() => expect(locks.waiting(LOCK)).toContain('exclusive'))
    await vi.waitFor(() => expect(slow.messages).toContain('session-changing'))
    expect(api.calls('POST', '/api/auth/login')).toBe(0)

    slow.release()
    await tab.tab.findByText('Olá, Bia.')
    expect(api.calls('POST', '/api/auth/login')).toBe(1)
    await vi.waitFor(() => expect(slow.messages).toEqual(['session-changing', 'session-changed']))
    slow.close()
  })

  it('refuses the login when a tab never gives up its lock, and sends nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    server.user = null
    const stuck = otherTab()
    await stuck.hold('shared')
    const tab = openTab('/login')
    await signInAsBia(tab)
    await vi.waitFor(() => expect(locks.waiting(LOCK)).toContain('exclusive'))

    await act(async () => {
      vi.advanceTimersByTime(COORDINATION_TIMEOUT_MS)
    })

    expect(await tab.tab.findByText(BUSY)).toBeTruthy()
    expect(api.calls('POST', '/api/auth/login')).toBe(0)
    expect(server.user).toBeNull()
    await vi.waitFor(() => expect(stuck.messages).toEqual(['session-changing', 'session-unchanged']))
    // The refused request left no exclusive request behind.
    expect(locks.waiting(LOCK)).not.toContain('exclusive')
    stuck.close()
  })
})

describe('lock bookkeeping', () => {
  it('holds one shared lock per tab when effects run twice, so changes are not refused', async () => {
    // StrictMode starts, stops and starts the tab session; a lock granted to the
    // request given up in between must be released, not kept for good.
    const first = openTab('/', { strict: true })
    await anaHomeIn(first)
    server.user = null
    const second = openTab('/login', { strict: true })
    await second.tab.findByRole('heading', { name: 'Entrar' })
    await vi.waitFor(() => expect(locks.holders(LOCK)).toEqual(['shared', 'shared']))

    await signInAsBia(second)

    await second.tab.findByText('Olá, Bia.')
    expect(api.calls('POST', '/api/auth/login')).toBe(1)
    await first.tab.findByText('Olá, Bia.')
  })
})

describe('browsers that cannot coordinate tabs', () => {
  it('refuses to sign in without BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    server.user = null
    const tab = openTab('/login')
    await signInAsBia(tab)

    expect(await tab.tab.findByText(UNSUPPORTED)).toBeTruthy()
    expect(api.calls('POST', '/api/auth/login')).toBe(0)
  })

  it('refuses to sign in without Web Locks', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    server.user = null
    const tab = openTab('/login')
    await signInAsBia(tab)

    expect(await tab.tab.findByText(UNSUPPORTED)).toBeTruthy()
    expect(api.calls('POST', '/api/auth/login')).toBe(0)
  })

  it('still logs out without them', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    api.routes['POST /api/auth/logout'] = () => {
      server.user = null
      return new Response(null, { status: 204 })
    }
    const tab = openTab('/')
    await anaHomeIn(tab)
    fireEvent.click(tab.tab.getByRole('button', { name: 'Sair' }))
    expect(await tab.tab.findByRole('link', { name: 'Entrar' })).toBeTruthy()
  })
})

describe('tabs that were hidden or told about a change', () => {
  it('a hidden tab gives up its lock and hides old data before showing again', async () => {
    const tab = openTab('/')
    await anaHomeIn(tab)

    setVisibility('hidden')
    await vi.waitFor(() => expect(locks.holders(LOCK)).toEqual([]))
    expect(tab.showsCatalog()).toBe(false)

    // Meanwhile another tab changed the session to Bia; the hidden tab blocks nothing.
    const other = otherTab()
    await other.hold('exclusive')
    server.user = bia
    other.close()
    const check = pending()
    api.routes['GET /api/auth/me'] = check.route
    // Bia's catalog is slow, so the tab shows before it arrives.
    const biasCatalog = pending()
    api.routes['GET /api/modules'] = biasCatalog.route

    setVisibility('visible')
    // Ana's data is not shown while the API is asked, lock taken.
    expect(tab.showsCatalog()).toBe(false)
    await vi.waitFor(() => expect(locks.holders(LOCK)).toEqual(['shared']))
    expect(tab.showsCatalog()).toBe(false)
    check.release(() => Response.json(bia))
    await tab.tab.findByText('Olá, Bia.')
    // Ana's cached catalog was dropped, not shown to Bia while hers loads.
    await vi.waitFor(() => expect(tab.catalogText()).toContain('Carregando…'))
    expect(tab.catalogText()).not.toContain('Concluída')
    biasCatalog.release(() => Response.json([catalogModule({ missions: [missionCard()] })]))
    await vi.waitFor(() => expect(tab.catalogText()).toContain('Arquivo de teste'))
    expect(tab.catalogText()).not.toContain('Concluída')
  })

  it("keeps a late validation of Ana out of Bia's cache when it ends during the change", async () => {
    const validation = pending()
    api.routes[`POST /api/labs/${labId}/validate`] = validation.route
    const tab = openTab(`/labs/${labId}`)
    fireEvent.click(await tab.tab.findByRole('button', { name: 'Verificar' }))
    await vi.waitFor(() => expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1))

    // Another tab changes the session to Bia.
    const other = otherTab()
    other.post('session-changing')
    await other.hold('exclusive')
    server.user = bia
    // Ana's validation answers while the change runs.
    validation.release(() =>
      Response.json({
        run_id: 1,
        outcome: 'passed',
        newly_completed: true,
        mission: { slug: 'sample-file', version: 1 },
        progress: completed(),
        result: null,
      }),
    )
    await vi.waitFor(() => expect(tab.client.isMutating()).toBe(0))
    // Whatever the old page shows of it stays hidden, and goes with the page.
    const shown = tab.tab.queryByText(/Missão concluída/)
    expect(shown === null || isInaccessible(shown)).toBe(true)
    other.post('session-changed')
    other.close()

    // The tab follows Bia: Ana's lab page is gone, Bia's catalog has nothing of Ana's.
    expect(await tab.tab.findByText('Laboratório não encontrado.')).toBeTruthy()
    fireEvent.click(tab.tab.getAllByRole('link', { name: 'Linux Lab' })[0] as HTMLElement)
    await tab.tab.findByText('Olá, Bia.')
    await vi.waitFor(() => expect(tab.catalogText()).toContain('Arquivo de teste'))
    expect(tab.catalogText()).not.toContain('Concluída')
    const modules = tab.client.getQueryData<CatalogModule[]>(['catalog', 'modules'])
    expect(modules?.[0]?.missions[0]?.progress.status).toBe('not_completed')
  })

  it('every tab confirms the session again after a failed login', async () => {
    const first = openTab('/')
    await anaHomeIn(first)
    server.user = null
    api.routes['POST /api/auth/login'] = () =>
      Response.json(
        { error: { code: 'invalid_credentials', message: 'Email ou senha incorretos.' } },
        { status: 401 },
      )

    const second = openTab('/login')
    await signInAsBia(second)

    expect(await second.tab.findByText('Email ou senha incorretos.')).toBeTruthy()
    // The first tab did not go back to Ana's data: it asked, and nobody is signed in.
    expect(await first.tab.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(first.tab.queryByText('Olá, Ana.')).toBeNull()
  })

  it('shows the same user again after a change that did not happen, once confirmed', async () => {
    const tab = openTab('/')
    await anaHomeIn(tab)
    const other = otherTab()
    other.post('session-changing')
    await vi.waitFor(() => expect(tab.showsCatalog()).toBe(false))

    const check = pending()
    api.routes['GET /api/auth/me'] = check.route
    other.post('session-unchanged')
    other.close()
    await vi.waitFor(() => expect(locks.holders(LOCK)).toEqual(['shared']))
    expect(tab.showsCatalog()).toBe(false)

    check.release(() => Response.json(ana))
    await vi.waitFor(() => expect(tab.catalogText()).toContain('Concluída'))
  })

  it('a tab told that a change started, and nothing else, checks again on its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const tab = openTab('/')
    await anaHomeIn(tab)
    const other = otherTab()
    other.post('session-changing')
    other.close()
    await vi.waitFor(() => expect(tab.showsCatalog()).toBe(false))
    const checks = api.calls('GET', '/api/auth/me')

    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_MS)
    })

    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(checks + 1))
    await vi.waitFor(() => expect(tab.catalogText()).toContain('Concluída'))
  })
})
