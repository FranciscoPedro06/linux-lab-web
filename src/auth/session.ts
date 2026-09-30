import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function useLogin() {
  const client = useQueryClient()
  return useMutation<User, ApiError, LoginInput>({
    mutationFn: (input) => login(input),
    onSuccess: (user) => client.setQueryData(meKey, user),
  })
}

export function useSignup() {
  const client = useQueryClient()
  return useMutation<User, ApiError, SignupInput>({
    mutationFn: (input) => signup(input),
    onSuccess: (user) => client.setQueryData(meKey, user),
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation<void, ApiError>({
    mutationFn: () => logout(),
    onSuccess: () => client.setQueryData(meKey, null),
  })
}
