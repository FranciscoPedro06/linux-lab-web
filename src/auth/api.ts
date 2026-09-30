// Client for the authentication endpoints (see docs/api.md in linux-lab-api).
// The session lives in an HttpOnly cookie set by the API; this code never sees the token.

export type User = {
  id: string
  email: string
  display_name: string
}

export type SignupInput = {
  email: string
  password: string
  display_name: string
  invite_code: string
}

export type LoginInput = {
  email: string
  password: string
}

const networkMessage = 'Não foi possível contatar o servidor. Tente novamente.'
const unexpectedMessage = 'Resposta inesperada do servidor. Tente novamente.'

// An error from the API, carrying its { error: { code, message } } body.
// `message` is written for the user; `code` is for the code.
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
  fetchImpl: FetchLike = fetch,
): Promise<T | undefined> {
  const init: RequestInit = { method, credentials: 'same-origin' }
  if (method !== 'GET') {
    // Every non-GET request is JSON; the API refuses anything else.
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body ?? {})
  }

  let response: Response
  try {
    response = await fetchImpl(path, init)
  } catch {
    throw new ApiError(0, 'network_error', networkMessage)
  }

  if (response.status === 204) return undefined
  const payload: unknown = await response.json().catch(() => undefined)
  if (response.ok) return payload as T

  const error = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error
  if (typeof error?.code === 'string' && typeof error.message === 'string') {
    throw new ApiError(response.status, error.code, error.message)
  }
  throw new ApiError(response.status, 'unexpected_response', unexpectedMessage)
}

async function expectUser(request: Promise<User | undefined>): Promise<User> {
  const user = await request
  if (!user) throw new ApiError(0, 'unexpected_response', unexpectedMessage)
  return user
}

export function signup(input: SignupInput, fetchImpl?: FetchLike): Promise<User> {
  return expectUser(apiRequest<User>('/api/auth/signup', { method: 'POST', body: input }, fetchImpl))
}

export function login(input: LoginInput, fetchImpl?: FetchLike): Promise<User> {
  return expectUser(apiRequest<User>('/api/auth/login', { method: 'POST', body: input }, fetchImpl))
}

export async function logout(fetchImpl?: FetchLike): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST' }, fetchImpl)
}

// The signed-in user, or null without a valid session.
export async function fetchMe(fetchImpl?: FetchLike): Promise<User | null> {
  try {
    return await expectUser(apiRequest<User>('/api/auth/me', {}, fetchImpl))
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}
