// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '../terminal/connection.ts'
import { ana, api, apiError, lab, labId, renderAt, signedOut } from '../testSupport.tsx'

// A stand-in terminal that records its props, so the test can play the connection.
const terminal = vi.hoisted(() => ({
  mounts: 0,
  sessions: [] as number[],
  onStatus: null as ((status: ConnectionStatus) => void) | null,
}))

vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: (props: {
    labId: string
    session: number
    closeRequested: boolean
    onStatus: (status: ConnectionStatus) => void
  }) => {
    terminal.onStatus = props.onStatus
    if (terminal.sessions.at(-1) !== props.session) terminal.sessions.push(props.session)
    return (
      <div data-testid="terminal">
        {props.labId} {props.closeRequested ? 'close requested' : 'open'}
      </div>
    )
  },
}))

const path = `/labs/${labId}`

function close(code: number, reason = 'fechou') {
  act(() => terminal.onStatus?.({ state: 'closed', reason, code }))
}

function connected() {
  act(() => terminal.onStatus?.({ state: 'connected' }))
}

beforeEach(() => {
  terminal.sessions = []
  terminal.onStatus = null
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    [`GET /api/labs/${labId}`]: () => Response.json(lab()),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('lab page', () => {
  it('sends a visitor without a session to login', async () => {
    api.routes['GET /api/auth/me'] = signedOut
    renderAt(path)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
  })

  it('opens the terminal of a ready lab', async () => {
    renderAt(path)

    expect((await screen.findByTestId('terminal')).textContent).toBe(`${labId} open`)
    expect(screen.getByText(/Encerra automaticamente/)).toBeTruthy()
  })

  it('reports a lab that does not exist or is not the user’s', async () => {
    api.routes[`GET /api/labs/${labId}`] = apiError(404, 'lab_not_found', 'Laboratório não encontrado.')
    renderAt(path)

    expect((await screen.findByRole('alert')).textContent).toBe('Laboratório não encontrado.')
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it('waits while the lab is prepared, then opens the terminal', async () => {
    let status: 'provisioning' | 'ready' = 'provisioning'
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab({ status }))
    renderAt(path)

    expect(await screen.findByText('Preparando o laboratório…')).toBeTruthy()
    status = 'ready'

    expect(await screen.findByTestId('terminal', {}, { timeout: 3000 })).toBeTruthy()
  })

  it('explains that the lab ran out of memory', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'oom', ended_at: 'x' }))
    renderAt(path)

    expect((await screen.findByRole('alert')).textContent).toMatch(/limite de memória/)
    expect(screen.queryByTestId('terminal')).toBeNull()
    expect(screen.getByRole('button', { name: 'Iniciar novo laboratório' })).toBeTruthy()
  })

  it('ends the lab', async () => {
    api.routes[`DELETE /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x' }))
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar laboratório' }))

    expect(await screen.findByText('Você encerrou o laboratório.')).toBeTruthy()
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it('starts a new lab after one ended', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'no_terminal', ended_at: 'x' }))
    const newId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    api.routes['POST /api/labs'] = () => Response.json(lab({ id: newId }), { status: 201 })
    api.routes[`GET /api/labs/${newId}`] = () => Response.json(lab({ id: newId }))
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar novo laboratório' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(`${newId} open`)
  })
})

describe('terminal close codes', () => {
  it('4410 shows the lab’s end from the API, without reconnecting', async () => {
    renderAt(path)
    await screen.findByTestId('terminal')
    connected()
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'no_input', ended_at: 'x' }))

    close(4410)

    expect(await screen.findByText(/30 minutos sem nada digitado/)).toBeTruthy()
    expect(terminal.sessions).toEqual([0])
  })

  it('4401 sends the user to login', async () => {
    renderAt(path)
    await screen.findByTestId('terminal')
    api.routes['GET /api/auth/me'] = signedOut

    close(4401)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
  })

  it.each([4000, 4409, 1000, 1008])('%i offers a manual reconnect only', async (code) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(path)
    await screen.findByTestId('terminal')
    connected()

    close(code)
    await act(() => vi.advanceTimersByTimeAsync(60000))

    expect(terminal.sessions).toEqual([0])
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar' }))
    expect(terminal.sessions).toEqual([0, 1])
  })

  it('reconnects after a dropped connection once the API says the lab is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(path)
    await screen.findByTestId('terminal')
    connected()
    const checks = api.calls('GET', `/api/labs/${labId}`)

    close(1006)
    expect(screen.getByRole('status').textContent).toMatch(/Reconectando em 1 s \(tentativa 1 de 5\)/)
    await act(() => vi.advanceTimersByTimeAsync(1100))

    expect(api.calls('GET', `/api/labs/${labId}`)).toBe(checks + 1)
    expect(terminal.sessions).toEqual([0, 1])
  })

  it('gives up after five failed attempts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(path)
    await screen.findByTestId('terminal')

    for (let attempt = 0; attempt < 5; attempt++) {
      close(1006)
      await act(() => vi.advanceTimersByTimeAsync(20000))
    }
    close(1006)
    await act(() => vi.advanceTimersByTimeAsync(60000))

    expect(terminal.sessions).toEqual([0, 1, 2, 3, 4, 5])
    expect(screen.getByRole('status').textContent).toMatch(/Não foi possível reconectar/)
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeTruthy()
  })

  it('does not reconnect to a lab that ended meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(path)
    await screen.findByTestId('terminal')
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'oom', ended_at: 'x' }))

    close(1011)
    await act(() => vi.advanceTimersByTimeAsync(1100))

    expect(await screen.findByText(/limite de memória/)).toBeTruthy()
    expect(terminal.sessions).toEqual([0])
  })

  it('counts an unreachable API as a failed attempt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(path)
    await screen.findByTestId('terminal')
    api.routes[`GET /api/labs/${labId}`] = () => Promise.reject(new TypeError('offline'))

    close(1006)
    await act(() => vi.advanceTimersByTimeAsync(1100))

    expect(screen.getByRole('status').textContent).toMatch(/tentativa 2 de 5/)
    expect(terminal.sessions).toEqual([0])
  })
})
