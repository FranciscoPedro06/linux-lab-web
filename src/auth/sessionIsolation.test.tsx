// @vitest-environment jsdom
// Responses that arrive after the signed-in identity changed: an operation started by
// one user must never write to the cache of the next one on the same tab, and a
// session changed in another tab must not leave one user's data under another's name.
import type { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModule, MissionDetail } from '../catalog/api.ts'
import type { Lab } from '../lab/api.ts'
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

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: () => <div data-testid="terminal" />,
}))

const bia = { id: '0b8f5d1e-2c4a-4b1d-8e6f-1a3b3f0c2e22', email: 'bia@example.com', display_name: 'Bia' }
const biaLabId = '9e2d4c1b-7a6f-4e3d-b2c1-a0f9e8d7c6b5'
const biaCatalog = () => [catalogModule({ missions: [missionCard()] })]

// A response the test releases when it wants.
function pending() {
  let release!: (response: Response) => void
  let fail!: (error: Error) => void
  const promise = new Promise<Response>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { route: () => promise, release, fail }
}

// Waits until the late response was consumed: no mutation is pending (their callbacks
// run before they settle) and no session check is in flight.
async function settled(client: QueryClient) {
  await vi.waitFor(() => {
    expect(client.isMutating()).toBe(0)
    expect(client.getQueryState(['auth', 'me'])?.fetchStatus).toBe('idle')
  })
  await act(async () => {})
}

// Ana's session expires: the session check, asked again, answers 401.
async function expire(client: QueryClient) {
  api.routes['GET /api/auth/me'] = signedOut
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['auth', 'me'] })
  })
}

// Bia signs in on the same tab and her home page loads, with her own lab and catalog.
async function biaSignsIn(biaLab: Lab | null = null) {
  api.routes['POST /api/auth/login'] = () => {
    api.routes['GET /api/auth/me'] = () => Response.json(bia)
    return Response.json(bia)
  }
  api.routes['GET /api/labs/current'] = () => Response.json(biaLab)
  api.routes['GET /api/labs'] = () => Response.json(biaLab ? [biaLab] : [])
  api.routes['GET /api/modules'] = () => Response.json(biaCatalog())
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'bia@example.com' } })
  fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  await screen.findByText('Olá, Bia.')
  const catalog = screen.getByRole('region', { name: 'Missões' })
  await within(catalog).findByRole('link', { name: 'Arquivo de teste' })
  return catalog
}

beforeEach(() => {
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    'GET /api/labs/current': () => Response.json(null),
    'GET /api/labs': () => Response.json([]),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
    [`GET /api/labs/${labId}/history?after=0&limit=500`]: () =>
      Response.json({ entries: [], more: false }),
    'GET /api/missions/sample-file': () => Response.json(missionDetail()),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

describe('late responses of operations started by the previous user', () => {
  it("does not write Ana's late validation into Bia's catalog or mission detail", async () => {
    const validation = pending()
    api.routes[`POST /api/labs/${labId}/validate`] = validation.route
    const { client } = renderAt(`/labs/${labId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await vi.waitFor(() => expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1))

    await expire(client)
    await screen.findByRole('heading', { name: 'Entrar' })
    const catalog = await biaSignsIn()
    // Bia also opens the mission, so its detail is cached for her.
    fireEvent.click(within(catalog).getByRole('link', { name: 'Arquivo de teste' }))
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
    await settled(client)

    expect(client.getQueryData(['catalog', 'modules'])).toEqual(before.modules)
    expect(client.getQueryData(['catalog', 'mission', 'sample-file'])).toEqual(before.detail)
    expect(screen.getByRole('banner').textContent).not.toContain('Concluída')
    expect(screen.queryByText(/Missão concluída/)).toBeNull()
  })

  it("does not refresh Bia's catalog for Ana's late validation failure", async () => {
    const validation = pending()
    api.routes[`POST /api/labs/${labId}/validate`] = validation.route
    const { client } = renderAt(`/labs/${labId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    await vi.waitFor(() => expect(api.calls('POST', `/api/labs/${labId}/validate`)).toBe(1))
    await expire(client)
    await screen.findByRole('heading', { name: 'Entrar' })
    await biaSignsIn()
    const fetched = api.calls('GET', '/api/modules')
    expect(client.isMutating()).toBe(1)

    validation.fail(new TypeError('Failed to fetch'))
    await settled(client)

    expect(api.calls('GET', '/api/modules')).toBe(fetched)
  })

  it("does not store Ana's late new lab for Bia", async () => {
    const creation = pending()
    api.routes['POST /api/labs'] = creation.route
    const { client } = renderAt('/missions/sample-file')
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))
    await vi.waitFor(() => expect(api.calls('POST', '/api/labs')).toBe(1))
    await expire(client)
    await screen.findByRole('heading', { name: 'Entrar' })
    await biaSignsIn(lab({ id: biaLabId }))
    await screen.findByRole('link', { name: 'Abrir terminal' })
    const polled = api.calls('GET', '/api/labs/current')

    creation.release(Response.json(lab(), { status: 201 }))
    await settled(client)

    expect(client.getQueryData(['labs', 'one', labId])).toBeUndefined()
    expect(client.getQueryData<Lab | null>(['labs', 'current'])?.id).toBe(biaLabId)
    expect(api.calls('GET', '/api/labs/current')).toBe(polled)
    expect(screen.getByRole('link', { name: 'Abrir terminal' }).getAttribute('href')).toBe(
      `/labs/${biaLabId}`,
    )
  })

  it("does not let Ana's late lab end touch Bia's labs", async () => {
    const ending = pending()
    api.routes[`DELETE /api/labs/${labId}`] = ending.route
    const { client } = renderAt(`/labs/${labId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar laboratório' }))
    await vi.waitFor(() => expect(api.calls('DELETE', `/api/labs/${labId}`)).toBe(1))
    await expire(client)
    await screen.findByRole('heading', { name: 'Entrar' })
    await biaSignsIn(lab({ id: biaLabId }))
    const polled = api.calls('GET', '/api/labs/current')

    ending.release(
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: '2026-09-30T12:30:00Z' })),
    )
    await settled(client)

    expect(client.getQueryData(['labs', 'one', labId])).toBeUndefined()
    expect(client.getQueryData<Lab | null>(['labs', 'current'])?.id).toBe(biaLabId)
    expect(api.calls('GET', '/api/labs/current')).toBe(polled)
  })

  it('still stores the result of an operation of the signed-in user', async () => {
    api.routes[`POST /api/labs/${labId}/validate`] = () =>
      Response.json({
        run_id: 1,
        outcome: 'passed',
        newly_completed: true,
        mission: { slug: 'sample-file', version: 1 },
        progress: completed(),
        result: null,
      })
    const { client } = renderAt(`/labs/${labId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
    expect(await screen.findByText(/Missão concluída/)).toBeTruthy()
    expect(
      client.getQueryData<MissionDetail>(['catalog', 'mission', 'sample-file'])?.progress.status,
    ).toBe('completed')
  })
})

describe('the session check on this tab', () => {
  it('keeps the new user when an older session check answers after the login', async () => {
    const check = pending()
    api.routes['GET /api/auth/me'] = signedOut
    const { client } = renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    // A session check sent with the expired session is still in flight.
    api.routes['GET /api/auth/me'] = check.route
    void client.invalidateQueries({ queryKey: ['auth', 'me'] })
    await vi.waitFor(() => expect(api.calls('GET', '/api/auth/me')).toBe(2))
    expect(client.getQueryState(['auth', 'me'])?.fetchStatus).toBe('fetching')

    await biaSignsIn()
    check.release(apiError(401, 'not_authenticated', 'Sessão inválida.')(undefined) as Response)
    await settled(client)

    expect(screen.getByText('Olá, Bia.')).toBeTruthy()
  })
})

describe('command history across users', () => {
  it("does not keep Ana's late history for Bia", async () => {
    const history = pending()
    api.routes[`GET /api/labs/${labId}/history?after=0&limit=500`] = history.route
    const { client } = renderAt(`/labs/${labId}`)
    await vi.waitFor(() =>
      expect(api.calls('GET', `/api/labs/${labId}/history?after=0&limit=500`)).toBe(1),
    )

    await expire(client)
    await screen.findByRole('heading', { name: 'Entrar' })
    await biaSignsIn(lab({ id: biaLabId }))
    api.routes[`GET /api/labs/${biaLabId}`] = () => Response.json(lab({ id: biaLabId }))
    api.routes[`GET /api/labs/${biaLabId}/history?after=0&limit=500`] = () =>
      Response.json({
        entries: [{ seq: 1, command: 'echo bia', recorded_at: '2026-10-25T12:00:00Z' }],
        more: false,
      })

    history.release(
      Response.json({
        entries: [{ seq: 1, command: 'echo ana-secret', recorded_at: '2026-10-25T12:00:00Z' }],
        more: false,
      }),
    )
    await settled(client)
    const cached = () =>
      JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))
    expect(cached()).not.toContain('ana-secret')

    fireEvent.click(await screen.findByRole('link', { name: 'Abrir terminal' }))
    expect(await screen.findByText('echo bia')).toBeTruthy()
    expect(screen.queryByText('echo ana-secret')).toBeNull()
    expect(cached()).not.toContain('ana-secret')
  })
})
