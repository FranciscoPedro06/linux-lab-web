// @vitest-environment jsdom
// The count of met criteria in the validation panel: from the last run only, never
// before a run, while one runs, for another lab, or for another user.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  notCompleted,
  renderAt,
  signedOut,
} from '../testSupport.tsx'
import type { ResultNode, ValidationRun, ValidationStatus } from './api.ts'

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

const path = `/labs/${labId}`
const validatePath = `/api/labs/${labId}/validate`
const newLabId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const bia = {
  id: '0b8f5d1e-2c4a-4b1d-8e6f-1a3b3f0c2e22',
  email: 'bia@example.com',
  display_name: 'Bia',
}

const check = (id: string, status: ValidationStatus): ResultNode => ({
  kind: 'check',
  id,
  status,
  message: `${id}: ${status}`,
})

// A run as the API sends it: the root's status is the outcome.
function run(result: ResultNode | null, overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    run_id: 1,
    outcome: result?.status ?? 'error',
    newly_completed: false,
    mission: { slug: 'sample-file', version: 1 },
    progress: notCompleted,
    result,
    ...overrides,
  }
}

function all(children: ResultNode[], message: string | null = null): ResultNode {
  const statuses = children.map((child) => child.status)
  const status = statuses.includes('failed')
    ? 'failed'
    : statuses.includes('error')
      ? 'error'
      : 'passed'
  return { kind: 'all', status, message, children }
}

// Like the real missions grown with groups: Permissões and Serviço, each an `all`.
function nested(process: ValidationStatus): ResultNode {
  return all([
    all([check('owner', 'passed'), check('group', 'passed')]),
    all([check('process', process), check('port', 'passed')], 'O serviço ainda não está pronto.'),
  ])
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

function status(): string {
  return (
    within(screen.getByRole('region', { name: 'Verificação' })).getByRole('status').textContent ??
    ''
  )
}

function counted(): string | null {
  const region = screen.queryByRole('region', { name: 'Verificação' })
  return region?.textContent?.match(/\d+ de \d+ critérios? atendidos?[^.]*\./)?.[0] ?? null
}

async function verify() {
  fireEvent.click(await screen.findByRole('button', { name: 'Verificar' }))
}

beforeEach(() => {
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    'GET /api/labs/current': () => Response.json(lab()),
    'GET /api/labs': () => Response.json([lab()]),
    'GET /api/modules': () => Response.json([]),
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

describe('the count of met criteria', () => {
  it('is not shown before any run', async () => {
    renderAt(path)

    expect(await screen.findByRole('button', { name: 'Verificar' })).toBeTruthy()
    expect(counted()).toBeNull()
  })

  it('follows the sentence of a failed run, in the same status', async () => {
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(run(all([check('a', 'passed'), check('b', 'failed'), check('c', 'passed')])))
    renderAt(path)
    await verify()

    await waitFor(() =>
      expect(status()).toBe('Missão ainda não concluída. 2 de 3 critérios atendidos.'),
    )
    // The individual criteria stay as they were.
    expect(
      within(screen.getByRole('list', { name: 'Critérios' })).getAllByRole('listitem'),
    ).toHaveLength(3)
  })

  it('counts the leaves of a nested mission, not its groups', async () => {
    api.routes[`POST ${validatePath}`] = () => Response.json(run(nested('failed')))
    renderAt(path)
    await verify()

    await waitFor(() =>
      expect(status()).toBe('Missão ainda não concluída. 3 de 4 critérios atendidos.'),
    )
    // Groups and leaves are all still listed: 2 groups + 4 checks.
    expect(
      within(screen.getByRole('list', { name: 'Critérios' })).getAllByRole('listitem'),
    ).toHaveLength(6)
  })

  it('says how many could not be checked when the run could not finish', async () => {
    api.routes[`POST ${validatePath}`] = () => Response.json(run(nested('error')))
    renderAt(path)
    await verify()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Não foi possível verificar o laboratório agora. Isso não conta como tentativa. 3 de 4 critérios atendidos (1 não verificado).',
    )
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
  })

  it('is n of n for a passed run', async () => {
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(run(nested('passed'), { newly_completed: true, progress: completed() }))
    renderAt(path)
    await verify()

    await waitFor(() =>
      expect(status()).toBe(
        'Missão concluída: o laboratório atende a todos os critérios. 4 de 4 critérios atendidos.',
      ),
    )
  })

  it('keeps the earlier wording when the tree has any or not, or no result', async () => {
    const withNot: ResultNode = {
      kind: 'all',
      status: 'failed',
      message: null,
      children: [
        check('a', 'passed'),
        {
          kind: 'not',
          status: 'failed',
          message: 'O arquivo secreto ainda existe.',
          children: [check('secret', 'passed')],
        },
      ],
    }
    const runs = [run(withNot), run(null, { outcome: 'failed' })]
    api.routes[`POST ${validatePath}`] = () => Response.json(runs.shift())
    renderAt(path)

    for (let i = 0; i < 2; i++) {
      await verify()
      await waitFor(() =>
        expect(status()).toBe('Missão ainda não concluída. Veja os critérios abaixo.'),
      )
      expect(counted()).toBeNull()
    }
  })

  it('is not shown while a run is in progress, and a new run replaces it', async () => {
    const second = pending()
    const runs: (() => Response | Promise<Response>)[] = [
      () =>
        Response.json(run(all([check('a', 'passed'), check('b', 'failed'), check('c', 'failed')]))),
      second.route,
    ]
    api.routes[`POST ${validatePath}`] = () => (runs.shift() as () => Response)()
    renderAt(path)

    await verify()
    await waitFor(() => expect(counted()).toBe('1 de 3 critérios atendidos.'))

    await verify()
    expect(await screen.findByRole('button', { name: 'Verificando…' })).toBeTruthy()
    expect(counted()).toBeNull()

    await second.release(
      Response.json(run(all([check('a', 'passed'), check('b', 'passed'), check('c', 'failed')]))),
    )
    await waitFor(() => expect(counted()).toBe('2 de 3 critérios atendidos.'))
    expect(api.calls('POST', validatePath)).toBe(2)
  })

  it('leaves a failed request to the existing error, without an old count', async () => {
    const runs: (() => Response)[] = [
      () => Response.json(run(all([check('a', 'passed'), check('b', 'failed')]))),
      apiError(429, 'rate_limited', 'Muitas verificações em pouco tempo.') as () => Response,
    ]
    api.routes[`POST ${validatePath}`] = (init) =>
      (runs.shift() as (i?: RequestInit) => Response)(init)
    renderAt(path)

    await verify()
    await waitFor(() => expect(counted()).toBe('1 de 2 critérios atendidos.'))
    await verify()

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Muitas verificações em pouco tempo.',
    )
    expect(counted()).toBeNull()
  })

  it('is not carried to the lab of another mission', async () => {
    const other = { slug: 'sample-answer', title: 'Resposta de teste', version: 3 }
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(run(all([check('a', 'passed'), check('b', 'failed')])))
    api.routes['GET /api/modules'] = () =>
      Response.json([catalogModule({ missions: [missionCard(), missionCard(other)] })])
    api.routes['GET /api/missions/sample-answer'] = () => Response.json(missionDetail(other))
    const created = lab({ id: newLabId, mission: other })
    api.routes[`POST /api/labs/${labId}/replace`] = () => Response.json(created, { status: 201 })
    api.routes[`GET /api/labs/${newLabId}`] = () => Response.json(created)
    api.routes[`GET /api/labs/${newLabId}/history?after=0&limit=500`] = () =>
      Response.json({ entries: [], more: false })
    renderAt(path)

    await verify()
    await waitFor(() => expect(counted()).toBe('1 de 2 critérios atendidos.'))

    // Home, the other mission's page, and the switch to it.
    fireEvent.click(
      within(screen.getAllByRole('banner')[0] as HTMLElement).getByRole('link', {
        name: 'Linux Lab',
      }),
    )
    fireEvent.click(await screen.findByRole('link', { name: 'Resposta de teste' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Trocar para esta missão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e trocar' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(newLabId)
    expect(await screen.findByRole('button', { name: 'Verificar' })).toBeTruthy()
    expect(counted()).toBeNull()
  })

  it('is not shown to the next user on the same tab', async () => {
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(run(all([check('a', 'passed'), check('b', 'failed')])))
    const { client } = renderAt(path)
    await verify()
    await waitFor(() => expect(counted()).toBe('1 de 2 critérios atendidos.'))

    // Ana's session ends; Bia signs in on this tab and opens her own lab.
    api.routes['GET /api/auth/me'] = signedOut
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['auth', 'me'] })
    })
    await screen.findByRole('heading', { name: 'Entrar' })
    const biaLab = lab({ id: newLabId })
    api.routes['POST /api/auth/login'] = () => {
      api.routes['GET /api/auth/me'] = () => Response.json(bia)
      return Response.json(bia)
    }
    api.routes['GET /api/labs/current'] = () => Response.json(biaLab)
    api.routes['GET /api/labs'] = () => Response.json([biaLab])
    api.routes[`GET /api/labs/${newLabId}`] = () => Response.json(biaLab)
    api.routes[`GET /api/labs/${newLabId}/history?after=0&limit=500`] = () =>
      Response.json({ entries: [], more: false })
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'bia@example.com' } })
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: 'synthetic password 01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await screen.findByText('Olá, Bia.')
    fireEvent.click(await screen.findByRole('link', { name: 'Abrir terminal' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(newLabId)
    expect(await screen.findByRole('button', { name: 'Verificar' })).toBeTruthy()
    expect(counted()).toBeNull()
  })
})
