import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  type LoginInput,
  type SignupInput,
  type User,
  fetchMe,
  login,
  logout,
  signup,
} from './api.ts'

const meKey = ['auth', 'me'] as const

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous' }
  | { status: 'error'; message: string; retry: () => void }

export function useAuth(): AuthState {
  const query = useQuery({ queryKey: meKey, queryFn: () => fetchMe() })
  if (query.isPending) return { status: 'loading' }
  if (query.isError) {
    const message =
      query.error instanceof ApiError ? query.error.message : 'Não foi possível verificar a sessão.'
    return { status: 'error', message, retry: () => void query.refetch() }
  }
  return query.data ? { status: 'authenticated', user: query.data } : { status: 'anonymous' }
}

// Labs and the catalog (which carries the user's progress) belong to one user. They
// are dropped whenever the session changes, so a new session never shows what was
// cached for the previous one, including after a session that expired without logout.
function forgetUserData(client: QueryClient) {
  client.removeQueries({ queryKey: ['labs'] })
  client.removeQueries({ queryKey: ['catalog'] })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation<User, ApiError, LoginInput>({
    mutationFn: (input) => login(input),
    onSuccess: (user) => {
      forgetUserData(client)
      client.setQueryData(meKey, user)
    },
  })
}

export function useSignup() {
  const client = useQueryClient()
  return useMutation<User, ApiError, SignupInput>({
    mutationFn: (input) => signup(input),
    onSuccess: (user) => {
      forgetUserData(client)
      client.setQueryData(meKey, user)
    },
  })
}

// Logout also ends the user's lab on the server; nothing cached about labs or the
// catalog survives it.
export function useLogout() {
  const client = useQueryClient()
  return useMutation<void, ApiError>({
    mutationFn: () => logout(),
    onSuccess: () => {
      forgetUserData(client)
      client.setQueryData(meKey, null)
    },
  })
}

// Asks the API again whether the session is valid, e.g. after the terminal was
// refused with 4401. Pages that need a user then send the visitor to login.
export function useRecheckSession(): () => void {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: meKey })
}
