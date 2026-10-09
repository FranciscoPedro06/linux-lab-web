// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ana,
  api,
  apiError,
  catalogModule,
  lab,
  missionCard,
  missionDetail,
  renderAt,
  signedOut,
} from '../testSupport.tsx'

function signedIn() {
  api.routes['GET /api/auth/me'] = () => Response.json(ana)
  api.routes['GET /api/labs/current'] = () => Response.json(null)
  api.routes['GET /api/labs'] = () => Response.json([])
}

async function catalogSection() {
  return screen.findByRole('region', { name: 'Missões' })
}

beforeEach(() => {
  api.routes = {}
  signedIn()
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

describe('catalog on the entry page', () => {
  it('lists modules and their missions in the order the API gives', async () => {
    api.routes['GET /api/modules'] = () =>
      Response.json([
        catalogModule({
          missions: [
            missionCard(),
            missionCard({
              slug: 'sample-answer',
              title: 'Resposta de teste',
              summary: 'Missão que espera uma resposta.',
              difficulty: 2,
              estimated_minutes: 10,
            }),
          ],
        }),
        catalogModule({ slug: 'beta', title: 'Outro módulo', description: 'Mais conteúdo.' }),
      ])
    renderAt('/')

    const section = await catalogSection()
    const modules = await within(section).findAllByRole('heading', { level: 3 })
    expect(modules.map((heading) => heading.textContent)).toEqual([
      'Módulo de teste',
      'Outro módulo',
    ])
    const first = within(section).getByRole('region', { name: 'Módulo de teste' })
    const links = within(first).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Arquivo de teste', '/missions/sample-file'],
      ['Resposta de teste', '/missions/sample-answer'],
    ])
    expect(within(first).getByText('Missão que espera uma resposta.')).toBeTruthy()
    expect(within(first).getByText('Dificuldade 2 de 5 · cerca de 10 min')).toBeTruthy()
  })

  it('shows an empty catalog without an error', async () => {
    api.routes['GET /api/modules'] = () => Response.json([])
    renderAt('/')

    const section = await catalogSection()
    expect(await within(section).findByText('Nenhuma missão publicada ainda.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // The lab panel is still there.
    expect(screen.getByRole('button', { name: 'Iniciar laboratório' })).toBeTruthy()
  })

  it('shows loading while the catalog is fetched', async () => {
    api.routes['GET /api/modules'] = () => new Promise<Response>(() => {})
    renderAt('/')

    const section = await catalogSection()
    expect(within(section).getByRole('status').textContent).toBe('Carregando…')
  })

  it('reports a failed request and retries', async () => {
    const failure = apiError(500, 'internal_error', 'Erro interno. Tente novamente.')
    api.routes['GET /api/modules'] = failure
    renderAt('/')

    const section = await catalogSection()
    expect((await within(section).findByRole('alert', {}, { timeout: 3000 })).textContent).toBe(
      'Erro interno. Tente novamente.',
    )
    api.routes['GET /api/modules'] = () => Response.json([catalogModule()])
    fireEvent.click(within(section).getByRole('button', { name: 'Tentar novamente' }))

    expect(await within(section).findByRole('link', { name: 'Arquivo de teste' })).toBeTruthy()
  })

  it('reports a network failure', async () => {
    api.routes['GET /api/modules'] = () => Promise.reject(new TypeError('offline'))
    renderAt('/')

    const section = await catalogSection()
    expect((await within(section).findByRole('alert', {}, { timeout: 3000 })).textContent).toBe(
      'Não foi possível contatar o servidor. Tente novamente.',
    )
  })

  it('checks the session again when the catalog says it expired', async () => {
    api.routes['GET /api/modules'] = () => {
      api.routes['GET /api/auth/me'] = signedOut
      return apiError(401, 'not_authenticated', 'Sessão inválida ou expirada.')(undefined)
    }
    renderAt('/')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
  })

  it('is not fetched for a visitor without a session', async () => {
    api.routes['GET /api/auth/me'] = signedOut
    renderAt('/')

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy()
    expect(api.calls('GET', '/api/modules')).toBe(0)
  })

  it('keeps the lab panel working next to the catalog', async () => {
    const ready = lab()
    api.routes['GET /api/labs/current'] = () => Response.json(ready)
    api.routes['GET /api/labs'] = () => Response.json([ready])
    api.routes['GET /api/modules'] = () => Response.json([catalogModule()])
    renderAt('/')

    expect(await screen.findByRole('link', { name: 'Abrir terminal' })).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Arquivo de teste' })).toBeTruthy()
  })

  it('opens a mission from the list', async () => {
    api.routes['GET /api/modules'] = () => Response.json([catalogModule()])
    api.routes['GET /api/missions/sample-file'] = () => Response.json(missionDetail())
    renderAt('/')

    fireEvent.click(await screen.findByRole('link', { name: 'Arquivo de teste' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })).toBeTruthy()
  })
})
