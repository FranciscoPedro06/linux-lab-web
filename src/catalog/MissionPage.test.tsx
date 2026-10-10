// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ana,
  api,
  apiError,
  lab,
  labId,
  missionDetail,
  renderAt,
  signedOut,
} from '../testSupport.tsx'

// The lab page is tested with a stand-in terminal; the real one is covered by Terminal.test.tsx.
vi.mock('../terminal/Terminal.tsx', () => ({
  Terminal: ({ labId }: { labId: string }) => <div data-testid="terminal">{labId}</div>,
}))

const path = '/missions/sample-file'

function current(value: ReturnType<typeof lab> | null) {
  api.routes['GET /api/labs/current'] = () => Response.json(value)
}

function labSection() {
  return screen.findByRole('region', { name: 'Laboratório' })
}

function mission(overrides: Parameters<typeof missionDetail>[0] = {}) {
  api.routes['GET /api/missions/sample-file'] = () => Response.json(missionDetail(overrides))
}

beforeEach(() => {
  api.routes = {
    'GET /api/auth/me': () => Response.json(ana),
    'GET /api/labs/current': () => Response.json(null),
  }
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  cleanup()
  api.fetch.mockClear()
  vi.unstubAllGlobals()
})

describe('starting a lab from the mission', () => {
  it('starts a lab for the mission and opens it', async () => {
    mission()
    api.routes['POST /api/labs'] = () => Response.json(lab(), { status: 201 })
    api.routes[`GET /api/labs/${labId}`] = () => Response.json(lab())
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    expect((await screen.findByTestId('terminal')).textContent).toBe(labId)
    const [, init] =
      api.fetch.mock.calls.find(([input, init]) => input === '/api/labs' && init?.method === 'POST') ??
      []
    expect(JSON.parse(String(init?.body))).toEqual({ mission_slug: 'sample-file' })
    expect(screen.getByRole('link', { name: 'Arquivo de teste' }).getAttribute('href')).toBe(
      '/missions/sample-file',
    )
  })

  it('shows that the lab is being prepared and sends one request', async () => {
    mission()
    api.routes['POST /api/labs'] = () => new Promise<Response>(() => {})
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    const button = await screen.findByRole('button', { name: 'Preparando…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/pode levar até um minuto/)).toBeTruthy()
    fireEvent.click(button)
    expect(api.calls('POST', '/api/labs')).toBe(1)
  })

  it('shows why the lab could not start', async () => {
    mission()
    api.routes['POST /api/labs'] = apiError(
      503,
      'lab_start_failed',
      'Não foi possível iniciar o laboratório. Tente novamente.',
    )
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    const section = await labSection()
    expect((await within(section).findByRole('alert')).textContent).toBe(
      'Não foi possível iniciar o laboratório. Tente novamente.',
    )
    expect(within(section).getByRole('button', { name: 'Iniciar laboratório' })).toBeTruthy()
  })

  it('shows the lab that blocks a refused start', async () => {
    mission()
    const other = lab({ mission: { slug: 'sample-answer', title: 'Resposta de teste', version: 3 } })
    api.routes['POST /api/labs'] = () => {
      current(other)
      return Response.json(
        {
          error: {
            code: 'active_lab_for_different_mission',
            message: 'Você já tem um laboratório ativo de outra missão.',
          },
        },
        { status: 409 },
      )
    }
    renderAt(path)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar laboratório' }))

    const section = await labSection()
    expect(await within(section).findByRole('link', { name: 'Abrir laboratório atual' })).toBeTruthy()
    expect(within(section).getByRole('alert').textContent).toBe(
      'Você já tem um laboratório ativo de outra missão.',
    )
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('offers the lab the user already has for this mission', async () => {
    mission()
    current(lab())
    renderAt(path)

    const section = await labSection()
    const link = await within(section).findByRole('link', { name: 'Abrir laboratório' })
    expect(link.getAttribute('href')).toBe(`/labs/${labId}`)
    expect(within(section).getByText('Seu laboratório desta missão está pronto.')).toBeTruthy()
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('offers a lab being prepared for this mission', async () => {
    mission()
    current(lab({ status: 'provisioning' }))
    renderAt(path)

    const section = await labSection()
    expect(await within(section).findByText('Preparando o laboratório…')).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'Abrir laboratório' })).toBeTruthy()
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('explains that the lab of another mission must end first, without replacing it', async () => {
    mission()
    current(lab({ mission: { slug: 'sample-answer', title: 'Resposta de teste', version: 3 } }))
    renderAt(path)

    const section = await labSection()
    const notice = await within(section).findByText(/A troca de missão ainda não está disponível/)
    expect(notice.textContent).toContain('“Resposta de teste”')
    const link = within(section).getByRole('link', { name: 'Abrir laboratório atual' })
    expect(link.getAttribute('href')).toBe(`/labs/${labId}`)
    expect(within(section).queryByRole('button')).toBeNull()
    expect(api.calls('POST', '/api/labs')).toBe(0)
  })

  it('waits while the previous lab is being ended', async () => {
    mission()
    current(lab({ status: 'terminating', end_reason: 'user', ended_at: 'x' }))
    renderAt(path)

    const section = await labSection()
    expect(await within(section).findByText(/está sendo encerrado/)).toBeTruthy()
    expect(within(section).queryByRole('button')).toBeNull()
    expect(within(section).queryByRole('link')).toBeNull()
  })
})

describe('mission page', () => {
  it('sends a visitor without a session to login', async () => {
    api.routes['GET /api/auth/me'] = signedOut
    renderAt(path)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
    expect(api.calls('GET', '/api/missions/sample-file')).toBe(0)
  })

  it('shows the mission', async () => {
    mission({ tags: ['permissions', 'chmod'], hints: ['Primeira dica.', 'Use `ls -l`.'] })
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })).toBeTruthy()
    expect(screen.getByText('Missão sintética sobre permissões.')).toBeTruthy()
    const meta = 'Dificuldade 1 de 5 · cerca de 5 min · permissions, chmod'
    expect(screen.getByText(meta)).toBeTruthy()
    expect(screen.getByRole('navigation').textContent).toBe('Linux Lab / Módulo de teste')

    // The briefing's own heading sits below the page title.
    const briefing = screen.getByRole('article', { name: 'Enunciado' })
    expect(briefing.querySelector('h2')?.textContent).toBe('Arquivo de teste')
    expect(briefing.querySelector('code')?.textContent).toBe('~/sample.sh')

    const objectives = screen.getByRole('region', { name: 'Objetivos' })
    const item = objectives.querySelector('li')
    expect(item?.innerHTML).toBe('<code>~/sample.sh</code> continua existindo.')

    const hints = screen.getByRole('region', { name: 'Dicas' })
    const details = hints.querySelectorAll('details')
    expect(details).toHaveLength(2)
    expect(details[0]?.open).toBe(false)
    expect(screen.getByText('Dica 2')).toBeTruthy()
    expect(details[1]?.querySelector('code')?.textContent).toBe('ls -l')
  })

  it('reads the mission and the current lab, and changes nothing', async () => {
    mission()
    renderAt(path)

    await screen.findByRole('button', { name: 'Iniciar laboratório' })
    expect(api.fetch.mock.calls.map(([input]) => input).sort()).toEqual([
      '/api/auth/me',
      '/api/labs/current',
      '/api/missions/sample-file',
    ])
  })

  it('says when the mission expects an answer', async () => {
    mission({ requires_answer: true })
    renderAt(path)

    const note = 'A missão é concluída com uma resposta enviada por você.'
    expect(await screen.findByText(note)).toBeTruthy()
  })

  it('omits the hints section without hints', async () => {
    mission({ hints: [] })
    renderAt(path)

    await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })
    expect(screen.queryByRole('region', { name: 'Dicas' })).toBeNull()
  })

  it('never renders raw HTML from the content', async () => {
    mission({
      briefing: [
        '# Título',
        '<script>window.injected = true</script>',
        '<img src="x" onerror="window.injected = true">',
        'Texto <b>negrito</b> [link](javascript:alert(1))',
      ].join('\n\n'),
      objectives: ['<img src="x" onerror="window.injected = true"> objetivo'],
      hints: ['<a href="https://example.com">fora</a> dica [link](https://example.com)'],
    })
    renderAt(path)

    const briefing = await screen.findByRole('article', { name: 'Enunciado' })
    const page = briefing.closest('main')
    expect(page?.querySelector('script, img, b, iframe')).toBeNull()
    expect(briefing.textContent).not.toContain('injected')
    const link = briefing.querySelector('a')
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript')
    // Objectives and hints keep their text and drop links and markup.
    expect(screen.getByRole('region', { name: 'Objetivos' }).querySelector('li')?.innerHTML).toBe(
      ' objetivo',
    )
    expect(screen.getByRole('region', { name: 'Dicas' }).querySelector('a')).toBeNull()
    expect(screen.getByRole('region', { name: 'Dicas' }).textContent).toContain('dica link')
    expect((window as { injected?: boolean }).injected).toBeUndefined()
  })

  it('shows not found for a missing or unpublished mission', async () => {
    api.routes['GET /api/missions/sample-file'] = apiError(
      404,
      'mission_not_found',
      'Missão não encontrada.',
    )
    renderAt(path)

    expect((await screen.findByRole('alert')).textContent).toBe('Missão não encontrada.')
    expect(api.calls('GET', '/api/missions/sample-file')).toBe(1)
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toBeTruthy()
  })

  it('shows loading while the mission is fetched', async () => {
    api.routes['GET /api/missions/sample-file'] = () => new Promise<Response>(() => {})
    renderAt(path)

    expect(await screen.findByText('Carregando a missão…')).toBeTruthy()
  })

  it('reports a failed request and retries', async () => {
    api.routes['GET /api/missions/sample-file'] = apiError(500, 'internal_error', 'Erro interno.')
    renderAt(path)

    // One automatic retry, a second later, before the error is shown.
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).toBe('Erro interno.')
    expect(api.calls('GET', '/api/missions/sample-file')).toBe(2)
    mission()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Arquivo de teste' })).toBeTruthy()
  })

  it('sends the user to login when the session expired', async () => {
    api.routes['GET /api/missions/sample-file'] = () => {
      api.routes['GET /api/auth/me'] = signedOut
      return apiError(401, 'not_authenticated', 'Sessão inválida ou expirada.')(undefined)
    }
    renderAt(path)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
  })

  it('encodes the slug in the request', async () => {
    const notFound = apiError(404, 'mission_not_found', 'Missão não encontrada.')
    api.routes['GET /api/missions/a%2Fb'] = notFound
    renderAt('/missions/a%2Fb')

    expect((await screen.findByRole('alert')).textContent).toBe('Missão não encontrada.')
  })
})
