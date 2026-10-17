// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ana, api, apiError, lab, labId, missionDetail, renderAt } from '../testSupport.tsx'
import type { ValidationRun } from './api.ts'

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: () => <div data-testid="terminal" />,
}))

const path = `/labs/${labId}`
const validatePath = `/api/labs/${labId}/validate`

function run(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    run_id: 1,
    outcome: 'failed',
    mission: { slug: 'sample-file', version: 1 },
    result: {
      kind: 'all',
      status: 'failed',
      message: null,
      children: [
        { kind: 'check', id: 'exists', status: 'passed', message: 'O arquivo existe.' },
        { kind: 'check', id: 'mode', status: 'failed', message: 'As permissões ainda não estão corretas.' },
      ],
    },
    ...overrides,
  }
}

function sentBodies(): unknown[] {
  return api.fetch.mock.calls
    .filter(([input, init]) => input === validatePath && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

async function verify() {
  const button = await screen.findByRole('button', { name: 'Verificar' })
  fireEvent.click(button)
}

beforeEach(() => {
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
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

describe('validation panel', () => {
  it('validates only when asked, with an empty body', async () => {
    api.routes[`POST ${validatePath}`] = () => Response.json(run({ outcome: 'passed' }))
    renderAt(path)

    await screen.findByRole('button', { name: 'Verificar' })
    expect(api.calls('POST', validatePath)).toBe(0)
    expect(screen.queryByLabelText('Sua resposta')).toBeNull()

    await verify()

    expect(await screen.findByText(/Missão concluída/)).toBeTruthy()
    expect(sentBodies()).toEqual([{}])
  })

  it('disables the button and shows progress while the request runs', async () => {
    api.routes[`POST ${validatePath}`] = () => new Promise<Response>(() => {})
    renderAt(path)

    await verify()

    const busy = await screen.findByRole('button', { name: 'Verificando…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Verificando o estado do laboratório…')).toBeTruthy()
    fireEvent.click(busy)
    expect(api.calls('POST', validatePath)).toBe(1)
  })

  it('shows each condition of an unfinished mission as text', async () => {
    const markup = '<img src=x onerror=alert(1)>'
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(
        run({
          result: {
            kind: 'all',
            status: 'failed',
            message: null,
            children: [
              { kind: 'check', id: 'exists', status: 'passed', message: 'O arquivo existe.' },
              {
                kind: 'any',
                status: 'failed',
                message: 'Não há cópia.',
                children: [{ kind: 'check', id: 'copy', status: 'failed', message: markup }],
              },
            ],
          },
        }),
      )
    renderAt(path)

    await verify()

    expect(await screen.findByText(/Missão ainda não concluída/)).toBeTruthy()
    const tree = screen.getByRole('list', { name: 'Critérios' })
    const items = within(tree).getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual([
      'Atendida O arquivo existe.',
      `Não atendida Não há cópia.Não atendida ${markup}`,
      `Não atendida ${markup}`,
    ])
    expect(document.querySelector('img')).toBeNull()
  })

  it('reports an operational error and retries only when asked', async () => {
    api.routes[`POST ${validatePath}`] = () =>
      Response.json(
        run({
          outcome: 'error',
          result: {
            kind: 'check',
            id: 'exists',
            status: 'error',
            message: 'Não foi possível verificar esta condição.',
          },
        }),
      )
    renderAt(path)

    await verify()

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível verificar o laboratório agora.',
    )
    expect(screen.getByText(/Não verificada/)).toBeTruthy()
    // No automatic retry.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.calls('POST', validatePath)).toBe(1)

    api.routes[`POST ${validatePath}`] = () => Response.json(run({ outcome: 'passed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Missão concluída/)).toBeTruthy()
    expect(api.calls('POST', validatePath)).toBe(2)
  })

  it('handles a run whose conditions could not be read', async () => {
    api.routes[`POST ${validatePath}`] = () => Response.json(run({ outcome: 'error', result: null }))
    renderAt(path)

    await verify()

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível verificar')
    expect(screen.queryByRole('list', { name: 'Critérios' })).toBeNull()
  })

  it('refreshes the lab when it is no longer ready', async () => {
    api.routes[`POST ${validatePath}`] = apiError(
      409,
      'lab_not_ready',
      'O laboratório não está pronto para ser verificado.',
    )
    renderAt(path)
    await screen.findByRole('button', { name: 'Verificar' })
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'container_lost', ended_at: '2026-09-30T12:30:00Z' }))

    await verify()

    expect(await screen.findByText('O laboratório parou inesperadamente.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verificar' })).toBeNull()
    expect(api.calls('POST', validatePath)).toBe(1)
  })

  it('shows a concurrent validation or the rate limit without retrying', async () => {
    api.routes[`POST ${validatePath}`] = apiError(
      409,
      'validation_in_progress',
      'Uma verificação deste laboratório já está em andamento.',
    )
    renderAt(path)

    await verify()

    expect((await screen.findByRole('alert')).textContent).toContain('já está em andamento')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.calls('POST', validatePath)).toBe(1)

    api.routes[`POST ${validatePath}`] = apiError(
      429,
      'rate_limited',
      'Muitas verificações em pouco tempo. Aguarde um momento.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Muitas verificações em pouco tempo. Aguarde um momento.')).toBeTruthy()
    expect(api.calls('POST', validatePath)).toBe(2)
  })

  it('asks for an answer when the mission requires one', async () => {
    api.routes['GET /api/missions/sample-file'] = () =>
      Response.json(missionDetail({ requires_answer: true }))
    api.routes[`POST ${validatePath}`] = () => Response.json(run({ outcome: 'passed' }))
    renderAt(path)

    const input = await screen.findByLabelText('Sua resposta')
    await verify()
    expect(await screen.findByText(/Missão concluída/)).toBeTruthy()

    fireEvent.change(input, { target: { value: ' lantern ' } })
    await verify()

    await vi.waitFor(() => expect(api.calls('POST', validatePath)).toBe(2))
    // An empty field is sent as no answer.
    expect(sentBodies()).toEqual([{}, { answer: ' lantern ' }])
  })

  it('refuses an answer longer than the API accepts', async () => {
    api.routes['GET /api/missions/sample-file'] = () =>
      Response.json(missionDetail({ requires_answer: true }))
    renderAt(path)

    const input = await screen.findByLabelText('Sua resposta')
    fireEvent.change(input, { target: { value: 'é'.repeat(513) } })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A resposta pode ter no máximo 1024 bytes.',
    )
    const button = screen.getByRole('button', { name: 'Verificar' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.calls('POST', validatePath)).toBe(0)
  })

  it('still validates when the mission detail cannot be read', async () => {
    api.routes['GET /api/missions/sample-file'] = apiError(500, 'internal_error', 'Erro interno.')
    api.routes[`POST ${validatePath}`] = () => Response.json(run())
    renderAt(path)

    await verify()

    expect(await screen.findByText(/Missão ainda não concluída/)).toBeTruthy()
    expect(sentBodies()).toEqual([{}])
  })
})
