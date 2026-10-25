// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '../terminal/connection.ts'
import { ana, api, apiError, lab, labId, missionDetail, renderAt, signedOut } from '../testSupport.tsx'

// A stand-in terminal that records its props, so the test can play the connection, and
// which labs have a terminal mounted (unmounting the real one closes its connection).
const terminal = vi.hoisted(() => ({
  mounts: 0,
  sessions: [] as number[],
  onStatus: null as ((status: ConnectionStatus) => void) | null,
  mounted: new Set<string>(),
  // Text the history panel inserted, and what the stand-in answers.
  inserted: [] as string[],
  insertResult: 'inserted' as 'inserted' | 'not_connected' | 'needs_bracketed_paste',
}))

vi.mock('../terminal/Terminal.tsx', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    Terminal: (props: {
      labId: string
      session: number
      closeRequested: boolean
      onStatus: (status: ConnectionStatus) => void
      insertRef?: { current: ((text: string) => string) | null }
    }) => {
      terminal.onStatus = props.onStatus
      if (props.insertRef) {
        props.insertRef.current = (text: string) => {
          terminal.inserted.push(text)
          return terminal.insertResult
        }
      }
      if (terminal.sessions.at(-1) !== props.session) terminal.sessions.push(props.session)
      useEffect(() => {
        terminal.mounted.add(props.labId)
        return () => {
          terminal.mounted.delete(props.labId)
        }
      }, [props.labId])
      return (
        <div data-testid="terminal">
          {props.labId} {props.closeRequested ? 'close requested' : 'open'}
        </div>
      )
    },
  }
})

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
  terminal.mounted.clear()
  terminal.inserted = []
  terminal.insertResult = 'inserted'
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
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

  it('follows a lab being ended until it is terminated', async () => {
    let status: 'terminating' | 'terminated' = 'terminating'
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status, end_reason: 'max_lifetime', ended_at: 'x' }))
    renderAt(path)

    expect(await screen.findByText('Encerrando')).toBeTruthy()
    expect(screen.queryByTestId('terminal')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar novo laboratório' })).toBeNull()
    status = 'terminated'

    expect(await screen.findByText('Encerrado', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText(/tempo máximo de 2 horas/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Iniciar novo laboratório' })).toBeTruthy()
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
    const [, init] =
      api.fetch.mock.calls.find(([input, init]) => input === '/api/labs' && init?.method === 'POST') ??
      []
    expect(JSON.parse(String(init?.body))).toEqual({ mission_slug: 'sample-file' })
  })

  it('shows the mission and the version the lab was created for', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ mission: { slug: 'sample-file', title: 'Arquivo de teste', version: 4 } }))
    renderAt(path)

    const link = await screen.findByRole('link', { name: 'Arquivo de teste' })
    expect(link.getAttribute('href')).toBe('/missions/sample-file')
    expect(link.closest('p')?.textContent).toBe('Missão: Arquivo de teste · versão 4')
  })

  it('shows the mission while the lab is prepared', async () => {
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab({ status: 'provisioning' }))
    renderAt(path)

    expect(await screen.findByText('Preparando o laboratório…')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Arquivo de teste' })).toBeTruthy()
  })

  it('shows Preparando while the new lab is created, and sends one request', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x' }))
    api.routes['POST /api/labs'] = () => new Promise<Response>(() => {})
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar novo laboratório' }))

    const button = await screen.findByRole('button', { name: 'Preparando…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(api.calls('POST', '/api/labs')).toBe(1)
  })

  it('offers no new lab for a lab without a mission', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x', mission: null }))
    renderAt(path)

    expect(await screen.findByText('Você encerrou o laboratório.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iniciar novo laboratório' })).toBeNull()
    expect(screen.queryByText(/Missão:/)).toBeNull()
  })

  it('shows why a new lab could not start', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x' }))
    api.routes['POST /api/labs'] = apiError(404, 'mission_not_found', 'Missão não encontrada.')
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar novo laboratório' }))

    expect(await screen.findByText('Missão não encontrada.')).toBeTruthy()
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

describe('resetting the lab', () => {
  const newLabId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
  const replacePath = `/api/labs/${labId}/replace`
  const replaced = lab({ status: 'terminated', end_reason: 'reset', ended_at: 'x' })

  function oldLab(value: ReturnType<typeof lab>) {
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(value)
  }

  function currentLab(value: ReturnType<typeof lab> | null) {
    api.routes['GET /api/labs/current'] = () => Response.json(value)
  }

  function opens(created: ReturnType<typeof lab>) {
    api.routes[`GET /api/labs/${created.id}`] = () => Response.json(created)
  }

  async function confirmReset() {
    fireEvent.click(await screen.findByRole('button', { name: 'Reiniciar laboratório' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Reiniciar o laboratório?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar e reiniciar' }))
  }

  function failWith(status: number, code: string, message: string, after?: () => void): void {
    api.routes[`POST ${replacePath}`] = () => {
      after?.()
      return Response.json({ error: { code, message } }, { status })
    }
  }

  beforeEach(() => {
    currentLab(lab())
  })

  it('asks first, saying what is discarded and that progress is kept', async () => {
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Reiniciar laboratório' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Reiniciar o laboratório?' })
    expect(dialog.textContent).toContain('Os arquivos, os processos e todo o estado temporário')
    expect(dialog.textContent).toContain('mesma missão')
    expect(dialog.textContent).toContain('Seu progresso permanece registrado')
    expect(dialog.textContent).toContain('não conclui nem desfaz nenhuma missão')
    // The terminal stays until the user confirms.
    expect(terminal.mounted.has(labId)).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(terminal.mounted.has(labId)).toBe(true)
    expect(api.calls('POST', replacePath)).toBe(0)
  })

  it('replaces the lab and connects to the new one', async () => {
    const created = lab({ id: newLabId })
    let finish: (response: Response) => void = () => {}
    api.routes[`POST ${replacePath}`] = () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      })
    opens(created)
    const { client } = renderAt(path)
    expect(await screen.findByTestId('terminal')).toBeTruthy()

    await confirmReset()

    expect(await screen.findByText('Reiniciando o laboratório…')).toBeTruthy()
    // The old lab's terminal is closed as soon as the reset starts.
    expect(terminal.mounted.has(labId)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Reiniciar laboratório' })).toBeNull()
    const [, init] = api.fetch.mock.calls.find(([input]) => input === replacePath) ?? []
    expect(JSON.parse(String(init?.body))).toEqual({ mission_slug: 'sample-file' })

    // The old lab ends while the request runs; the page keeps showing the reset.
    oldLab(lab({ status: 'terminating', end_reason: 'reset', ended_at: 'x' }))
    await act(() => client.invalidateQueries({ queryKey: ['labs', 'one', labId] }))
    expect(screen.getByText('Reiniciando o laboratório…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iniciar novo laboratório' })).toBeNull()

    currentLab(created)
    const answered = Date.now()
    finish(Response.json(created, { status: 201 }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(`${newLabId} open`)
    expect([...terminal.mounted]).toEqual([newLabId])
    expect(api.calls('POST', replacePath)).toBe(1)
    // The old lab and the mission's detail are read again (or marked to be, when no
    // page shows them any more).
    for (const key of [
      ['labs', 'one', labId],
      ['catalog', 'mission', 'sample-file'],
    ]) {
      const state = client.getQueryState(key)
      expect(state?.isInvalidated || (state?.dataUpdatedAt ?? 0) >= answered).toBe(true)
    }
  })

  it('keeps the lab when the reset is refused before it ends', async () => {
    failWith(429, 'rate_limited', 'Muitos laboratórios iniciados em pouco tempo.')
    renderAt(path)

    await confirmReset()

    expect((await screen.findByRole('alert')).textContent).toMatch(/Muitos laboratórios/)
    expect((await screen.findByTestId('terminal')).textContent).toBe(`${labId} open`)
    const again = await screen.findByRole('button', { name: 'Reiniciar laboratório' })
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false))
    expect(api.calls('POST', replacePath)).toBe(1)
  })

  it('offers a new lab, never the same reset, when the new lab failed', async () => {
    failWith(503, 'lab_start_failed', 'Não foi possível iniciar o novo laboratório.', () => {
      oldLab(replaced)
      currentLab(null)
    })
    const created = lab({ id: newLabId })
    api.routes['POST /api/labs'] = () => Response.json(created, { status: 201 })
    opens(created)
    renderAt(path)

    await confirmReset()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível iniciar o novo laboratório.',
    )
    expect(await screen.findByText('Você não tem um laboratório ativo.')).toBeTruthy()
    expect(screen.getByText(/O laboratório foi reiniciado/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar novo laboratório' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(`${newLabId} open`)
    expect(api.calls('POST', replacePath)).toBe(1)
    expect(api.calls('POST', '/api/labs')).toBe(1)
  })

  it('shows a pending removal and lets the user ask again', async () => {
    const ending = lab({ status: 'terminating', end_reason: 'reset', ended_at: 'x' })
    const message = 'O laboratório anterior ainda está sendo removido.'
    failWith(503, 'previous_lab_not_removed', message, () => {
      oldLab(ending)
      currentLab(ending)
    })
    renderAt(path)

    await confirmReset()

    expect(await screen.findByText('A remoção deste laboratório ainda não terminou.')).toBeTruthy()
    const created = lab({ id: newLabId })
    api.routes[`POST ${replacePath}`] = () => Response.json(created, { status: 201 })
    opens(created)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(`${newLabId} open`)
    expect(api.calls('POST', replacePath)).toBe(2)
  })

  it('reads the state again after a lost answer and opens the lab that replaced it', async () => {
    api.routes[`POST ${replacePath}`] = () => {
      oldLab(replaced)
      currentLab(lab({ id: newLabId }))
      throw new TypeError('Failed to fetch')
    }
    renderAt(path)

    await confirmReset()

    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível confirmar/)
    const link = await screen.findByRole('link', { name: 'Abrir laboratório atual' })
    expect(link.getAttribute('href')).toBe(`/labs/${newLabId}`)
    expect(screen.getByText('Seu laboratório atual está pronto.')).toBeTruthy()
    expect(api.calls('POST', replacePath)).toBe(1)
  })

  it('points to the new lab when it was reset elsewhere', async () => {
    oldLab(replaced)
    currentLab(lab({ id: newLabId, status: 'provisioning' }))
    renderAt(path)

    expect(await screen.findByText(/O laboratório foi reiniciado/)).toBeTruthy()
    expect(await screen.findByText('Seu laboratório atual está sendo preparado.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir laboratório atual' }).getAttribute('href')).toBe(
      `/labs/${newLabId}`,
    )
    expect(screen.queryByRole('button', { name: 'Iniciar novo laboratório' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('explains a lab left for another mission', async () => {
    oldLab(lab({ status: 'terminated', end_reason: 'mission_switch', ended_at: 'x' }))
    currentLab(null)
    renderAt(path)

    expect(await screen.findByText(/Você trocou de missão/)).toBeTruthy()
    expect(await screen.findByText('Você não tem um laboratório ativo.')).toBeTruthy()
  })

  it('offers no reset for a lab without a mission', async () => {
    oldLab(lab({ mission: null }))
    renderAt(path)

    expect(await screen.findByTestId('terminal')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reiniciar laboratório' })).toBeNull()
  })
})

describe('command history', () => {
  const historyPath = (id: string, after = 0) => `/api/labs/${id}/history?after=${after}&limit=500`
  const entry = (seq: number, command: string) => ({
    seq,
    command,
    recorded_at: '2026-10-25T12:00:00Z',
  })

  function recorded(): string[] {
    const list = screen.queryByRole('list', { name: 'Comandos registrados' })
    if (!list) return []
    return within(list)
      .queryAllByRole('listitem')
      .map((item) => item.querySelector('code')?.textContent ?? '')
  }

  it('tells the student what is recorded next to the terminal', async () => {
    renderAt(path)
    await screen.findByTestId('terminal')

    const notice = screen.getByRole('note')
    expect(notice.textContent).toContain('inclusive texto sensível e conteúdo de heredocs')
    expect(notice.textContent).toContain('comece a linha com um espaço')
    expect(notice.textContent).toContain('não há remoção automática')
    const terminalSection = screen.getByTestId('terminal').closest('section')
    expect(terminalSection?.getAttribute('aria-describedby')).toBe(notice.id)
  })

  it('shows the lab history and inserts a command without running it', async () => {
    api.routes[`GET ${historyPath(labId)}`] = () =>
      Response.json({ entries: [entry(1, 'ls -la'), entry(2, 'cat notas.txt')], more: false })
    renderAt(path)
    await waitFor(() => expect(recorded()).toEqual(['ls -la', 'cat notas.txt']))

    const second = screen.getByText('cat notas.txt').closest('li') as HTMLElement
    fireEvent.click(within(second).getByRole('button', { name: 'Inserir no terminal' }))

    expect(terminal.inserted).toEqual(['cat notas.txt'])
    expect(screen.getByText(/Revise e pressione Enter/)).toBeTruthy()
    // Inserting sends nothing to the API.
    expect(api.fetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('shows the history of an ended lab when asked', async () => {
    api.routes[`GET /api/labs/${labId}`] = () =>
      Response.json(lab({ status: 'terminated', end_reason: 'user', ended_at: 'x' }))
    api.routes[`GET ${historyPath(labId)}`] = () =>
      Response.json({ entries: [entry(1, 'ls')], more: false })
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Mostrar histórico de comandos' }))

    await waitFor(() => expect(recorded()).toEqual(['ls']))
    expect(screen.queryByRole('button', { name: 'Inserir no terminal' })).toBeNull()
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it("shows only the new lab's history after a reset", async () => {
    const newLabId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    api.routes[`GET ${historyPath(labId)}`] = () =>
      Response.json({ entries: [entry(1, 'echo old-lab')], more: false })
    api.routes[`GET ${historyPath(newLabId)}`] = () =>
      Response.json({ entries: [], more: false })
    api.routes[`POST /api/labs/${labId}/replace`] = () =>
      Response.json(lab({ id: newLabId }), { status: 201 })
    api.routes[`GET /api/labs/${newLabId}`] = () => Response.json(lab({ id: newLabId }))
    api.routes['GET /api/labs/current'] = () => Response.json(lab({ id: newLabId }))
    api.routes['GET /api/labs'] = () => Response.json([lab({ id: newLabId })])
    renderAt(path)
    await waitFor(() => expect(recorded()).toEqual(['echo old-lab']))

    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar laboratório' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar e reiniciar' }))

    expect(await screen.findByText('Nenhum comando registrado neste laboratório.')).toBeTruthy()
    expect(screen.queryByText('echo old-lab')).toBeNull()
    expect(terminal.mounted.has(newLabId)).toBe(true)
  })
})
