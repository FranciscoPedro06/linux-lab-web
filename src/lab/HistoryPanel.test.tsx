// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiError, labId } from '../testSupport.tsx'
import type { HistoryEntry } from './api.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import { HISTORY_POLL_MS, labKeys } from './queries.ts'

function entry(seq: number, command = `echo ${seq}`): HistoryEntry {
  return { seq, command, recorded_at: '2026-10-25T12:00:00Z' }
}

function page(entries: HistoryEntry[], more = false): Response {
  return Response.json({ entries, more })
}

const historyPath = (after: number) => `/api/labs/${labId}/history?after=${after}&limit=500`

function renderPanel(props: { live?: boolean; labId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <HistoryPanel labId={props.labId ?? labId} live={props.live ?? true} />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

function commands(): string[] {
  const list = screen.queryByRole('list', { name: 'Comandos registrados' })
  if (!list) return []
  return within(list)
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('code')?.textContent ?? '')
}

beforeEach(() => {
  api.routes = {}
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('history panel', () => {
  it('says when nothing was recorded', async () => {
    api.routes[`GET ${historyPath(0)}`] = () => page([])
    renderPanel()

    expect(screen.getByRole('status').textContent).toBe('Carregando o histórico…')
    expect(await screen.findByText('Nenhum comando registrado neste laboratório.')).toBeTruthy()
  })

  it('lists commands in seq order, as text', async () => {
    api.routes[`GET ${historyPath(0)}`] = () =>
      page([entry(1, 'ls -la'), entry(2, '<b>bold</b> && echo "x"'), entry(3, 'cat <<EOF\nl1\nEOF')])
    const { container } = renderPanel()

    await waitFor(() => expect(commands()).toHaveLength(3))
    expect(commands()).toEqual(['ls -la', '<b>bold</b> && echo "x"', 'cat <<EOF\nl1\nEOF'])
    expect(container.querySelector('b')).toBeNull()
  })

  it('reads every page there is', async () => {
    const first = Array.from({ length: 500 }, (_, index) => entry(index + 1))
    api.routes[`GET ${historyPath(0)}`] = () => page(first, true)
    api.routes[`GET ${historyPath(500)}`] = () => page([entry(501), entry(502)])
    renderPanel()

    // The newest 200 are shown; earlier ones on request.
    await waitFor(() => expect(commands()).toHaveLength(200))
    expect(commands().at(-1)).toBe('echo 502')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar comandos anteriores (302)' }))
    expect(commands()).toHaveLength(400)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar comandos anteriores (102)' }))
    expect(commands()).toHaveLength(502)
    expect(commands()[0]).toBe('echo 1')
    expect(screen.queryByRole('button', { name: /anteriores/ })).toBeNull()
  })

  it('polls for new entries only after the last one held, without duplicates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.routes[`GET ${historyPath(0)}`] = () => page([entry(1), entry(2)])
    // An overlapping answer adds only what is new.
    api.routes[`GET ${historyPath(2)}`] = () => page([entry(2), entry(3)])
    api.routes[`GET ${historyPath(3)}`] = () => page([])
    renderPanel()
    await waitFor(() => expect(commands()).toEqual(['echo 1', 'echo 2']))

    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS + 100))
    await waitFor(() => expect(commands()).toEqual(['echo 1', 'echo 2', 'echo 3']))
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS + 100))

    expect(api.calls('GET', historyPath(3))).toBeGreaterThanOrEqual(1)
    expect(commands()).toEqual(['echo 1', 'echo 2', 'echo 3'])
  })

  it('keeps what it has when a poll fails, and catches up on the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.routes[`GET ${historyPath(0)}`] = () => page([entry(1)])
    api.routes[`GET ${historyPath(1)}`] = apiError(503, 'unavailable', 'Indisponível.')
    renderPanel()
    await waitFor(() => expect(commands()).toEqual(['echo 1']))

    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS + 100))
    expect(await screen.findByText(/Não foi possível atualizar o histórico/)).toBeTruthy()
    expect(commands()).toEqual(['echo 1'])

    api.routes[`GET ${historyPath(1)}`] = () => page([entry(2)])
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS + 100))
    await waitFor(() => expect(commands()).toEqual(['echo 1', 'echo 2']))
    expect(screen.queryByText(/Não foi possível atualizar o histórico/)).toBeNull()
  })

  it('shows an error with a retry when nothing could be read', async () => {
    api.routes[`GET ${historyPath(0)}`] = apiError(503, 'unavailable', 'Serviço indisponível.')
    renderPanel()

    // The hook retries once before reporting the error.
    expect(await screen.findByText('Serviço indisponível.', {}, { timeout: 5000 })).toBeTruthy()
    api.routes[`GET ${historyPath(0)}`] = () => page([entry(1, 'pwd')])
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(commands()).toEqual(['pwd']))
  })

  it('says when the lab reached the limit', async () => {
    const all = Array.from({ length: 2000 }, (_, index) => entry(index + 1))
    api.routes[`GET ${historyPath(0)}`] = () => page(all.slice(0, 500), true)
    api.routes[`GET ${historyPath(500)}`] = () => page(all.slice(500, 1000), true)
    api.routes[`GET ${historyPath(1000)}`] = () => page(all.slice(1000, 1500), true)
    api.routes[`GET ${historyPath(1500)}`] = () => page(all.slice(1500), false)
    renderPanel()

    expect(await screen.findByText(/atingiu o limite de 2000 comandos/)).toBeTruthy()
  })

  it('reads the history of an ended lab only when asked, and does not poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.routes[`GET ${historyPath(0)}`] = () => page([entry(1, 'ls')])
    renderPanel({ live: false })

    expect(screen.getByRole('note').textContent).toContain('comece a linha com um espaço')
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS * 3))
    expect(api.calls('GET', historyPath(0))).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar histórico de comandos' }))
    await waitFor(() => expect(commands()).toEqual(['ls']))
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_POLL_MS * 3))
    expect(api.calls('GET', historyPath(0))).toBe(1)
    expect(api.calls('GET', historyPath(1))).toBe(0)
  })

  it('keeps each lab apart in the cache', async () => {
    const other = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    api.routes[`GET ${historyPath(0)}`] = () => page([entry(1, 'mine')])
    api.routes[`GET /api/labs/${other}/history?after=0&limit=500`] = () =>
      page([entry(1, 'other lab')])
    const { client, unmount } = renderPanel()
    await waitFor(() => expect(commands()).toEqual(['mine']))
    unmount()

    const second = render(
      <QueryClientProvider client={client}>
        <HistoryPanel labId={other} live />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(commands()).toEqual(['other lab']))
    expect(client.getQueryData(labKeys.history(labId))).toEqual([entry(1, 'mine')])
    second.unmount()
  })
})
