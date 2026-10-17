import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
import { forgetUserData, useSessionChange } from './tabs.tsx'

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

// Records the signed-in user (null after logout) once the session changed on this
// tab. Labs and the catalog of the previous session are dropped, so a new session
// never shows what was cached for the previous one. A session check still in flight
// was sent with the previous session; it is cancelled so that its answer cannot
// replace the new user.
async function sessionChanged(client: QueryClient, user: User | null) {
  await client.cancelQueries({ queryKey: meKey })
  forgetUserData(client)
  client.setQueryData(meKey, user)
}

// Login, sign-up and logout change the session cookie shared by every tab; they run
// in coordination with the other tabs (see tabs.tsx), and the cache is updated
// before the other tabs are told.
export function useLogin() {
  const client = useQueryClient()
  const change = useSessionChange()
  return useMutation<User, ApiError, LoginInput>({
    mutationFn: (input) =>
      change(async () => {
        const user = await login(input)
        await sessionChanged(client, user)
        return user
      }),
  })
}

export function useSignup() {
  const client = useQueryClient()
  const change = useSessionChange()
  return useMutation<User, ApiError, SignupInput>({
    mutationFn: (input) =>
      change(async () => {
        const user = await signup(input)
        await sessionChanged(client, user)
        return user
      }),
  })
}

// Logout also ends the user's lab on the server; nothing cached about labs or the
// catalog survives it. It leaves no user signed in, so it is allowed even where the
// other tabs cannot be coordinated.
export function useLogout() {
  const client = useQueryClient()
  const change = useSessionChange()
  return useMutation<void, ApiError>({
    mutationFn: () =>
      change(async () => {
        await logout()
        await sessionChanged(client, null)
      }, true),
  })
}

// Asks the API again whether the session is valid, e.g. after the terminal was
// refused with 4401. Pages that need a user then send the visitor to login.
export function useRecheckSession(): () => void {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: meKey })
}

// Operations of the signed-in user whose results go into the cache. The user who
// started an operation is recorded when it starts (from the session check); its
// callbacks run only if that user is still the one signed in when it answers. An
// answer that arrives after the session expired, after another user signed in on
// this tab, or for an operation started without a known user writes nothing, and no
// page shows it. Comparing the user, not the session, is enough here: a result for
// the same user who signed in again is still their own data.

type StartedBy = { userId: string | null }

function signedInUserId(client: QueryClient): string | null {
  return client.getQueryData<User | null>(meKey)?.id ?? null
}

function stillSignedIn(client: QueryClient, started: StartedBy | undefined): boolean {
  return started?.userId != null && signedInUserId(client) === started.userId
}

export function useUserMutation<TData, TVariables>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>
  retry?: false
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: ApiError, variables: TVariables) => void
}): UseMutationResult<TData, ApiError, TVariables, StartedBy> {
  const client = useQueryClient()
  return useMutation<TData, ApiError, TVariables, StartedBy>({
    mutationFn: options.mutationFn,
    retry: options.retry,
    onMutate: () => ({ userId: signedInUserId(client) }),
    onSuccess: (data, variables, started) => {
      if (stillSignedIn(client, started)) options.onSuccess?.(data, variables)
    },
    onError: (error, variables, started) => {
      if (stillSignedIn(client, started)) options.onError?.(error, variables)
    },
  })
}
