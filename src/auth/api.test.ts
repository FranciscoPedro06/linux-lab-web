import { describe, expect, it, vi } from 'vitest'
import { ApiError, fetchMe, login, logout, signup } from './api.ts'

const user = { id: '7d0e0c43-3f5a-4a53-9d1a-1a3b3f0c2e11', email: 'ana@example.com', display_name: 'Ana' }

function reply(status: number, body?: unknown) {
  return vi.fn(async () =>
    body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
  )
}

describe('auth api', () => {
  it('sends JSON with same-origin credentials and returns the user', async () => {
    const fetchImpl = reply(200, user)

    await expect(login({ email: 'ana@example.com', password: 'x' }, fetchImpl)).resolves.toEqual(user)

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@example.com', password: 'x' }),
    })
  })

  it('posts the sign-up form', async () => {
    const fetchImpl = reply(201, user)
    const input = { email: 'a@example.com', password: 'p', display_name: 'A', invite_code: 'c' }

    await signup(input, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/signup',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    )
  })

  it('sends logout as a JSON request and accepts an empty reply', async () => {
    const fetchImpl = reply(204)

    await expect(logout(fetchImpl)).resolves.toBeUndefined()

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    )
  })

  it('reads me with a plain GET', async () => {
    const fetchImpl = reply(200, user)

    await expect(fetchMe(fetchImpl)).resolves.toEqual(user)

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
    })
  })

  it('treats 401 on me as signed out', async () => {
    const fetchImpl = reply(401, { error: { code: 'not_authenticated', message: 'Sessão inválida.' } })

    await expect(fetchMe(fetchImpl)).resolves.toBeNull()
  })

  it('turns the error body into an ApiError with the server message', async () => {
    const fetchImpl = reply(409, { error: { code: 'email_taken', message: 'Já existe uma conta.' } })

    const error = await signup(
      { email: 'a@example.com', password: 'p', display_name: 'A', invite_code: 'c' },
      fetchImpl,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'email_taken', message: 'Já existe uma conta.' })
  })

  it('does not trust bodies without the error format', async () => {
    const error = await fetchMe(reply(502, { detail: 'Bad gateway' })).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ status: 502, code: 'unexpected_response' })
  })

  it('reports network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(fetchMe(fetchImpl)).rejects.toMatchObject({ code: 'network_error' })
  })
})
