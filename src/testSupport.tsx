// A fake API and a renderer for page tests in jsdom.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { App } from './App.tsx'
import type { CatalogModule, MissionCard, MissionDetail } from './catalog/api.ts'
import type { Lab } from './lab/api.ts'

export type Route = (init: RequestInit | undefined) => Response | Promise<Response>

export const ana = {
  id: '7d0e0c43-3f5a-4a53-9d1a-1a3b3f0c2e11',
  email: 'ana@example.com',
  display_name: 'Ana',
}

export const labId = '3f1c2b9a-8d7e-4f60-a5b4-c3d2e1f0a9b8'

export function lab(overrides: Partial<Lab> = {}): Lab {
  return {
    id: labId,
    status: 'ready',
    end_reason: null,
    created_at: '2026-09-30T12:00:00Z',
    expires_at: '2026-09-30T14:00:00Z',
    ended_at: null,
    mission: { slug: 'sample-file', title: 'Arquivo de teste', version: 1 },
    ...overrides,
  }
}

export function missionCard(overrides: Partial<MissionCard> = {}): MissionCard {
  return {
    slug: 'sample-file',
    title: 'Arquivo de teste',
    summary: 'Missão sintética sobre permissões.',
    difficulty: 1,
    estimated_minutes: 5,
    tags: ['permissions'],
    version: 1,
    requires_answer: false,
    ...overrides,
  }
}

export function catalogModule(overrides: Partial<CatalogModule> = {}): CatalogModule {
  return {
    slug: 'alpha',
    title: 'Módulo de teste',
    description: 'Conteúdo sintético.',
    missions: [missionCard()],
    ...overrides,
  }
}

export function missionDetail(overrides: Partial<MissionDetail> = {}): MissionDetail {
  return {
    ...missionCard(),
    module: { slug: 'alpha', title: 'Módulo de teste' },
    briefing: '# Arquivo de teste\n\nO arquivo `~/sample.sh` pode ser lido por qualquer usuário.\n',
    objectives: ['`~/sample.sh` continua existindo.'],
    hints: ['Veja as permissões com `ls -l`.'],
    ...overrides,
  }
}

export function apiError(status: number, code: string, message: string): Route {
  return () => Response.json({ error: { code, message } }, { status })
}

export const signedOut = apiError(401, 'not_authenticated', 'Sessão inválida.')

// Each test sets the replies for the routes it uses; anything else fails the test.
export const api = {
  routes: {} as Record<string, Route>,
  fetch: vi.fn(async (input: string, init?: RequestInit) => {
    const route = api.routes[`${init?.method ?? 'GET'} ${input}`]
    if (!route) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${input}`)
    return route(init)
  }),
  calls(method: string, path: string): number {
    return api.fetch.mock.calls.filter(
      ([input, init]) => input === path && (init?.method ?? 'GET') === method,
    ).length
  },
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
