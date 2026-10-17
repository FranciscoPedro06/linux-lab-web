import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
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

// Records the signed-in user (null after logout) once the session changed on this
// tab. A session check still in flight was sent with the previous session; it is
// cancelled so that its answer cannot replace the new user. Other tabs are told.
async function sessionChanged(client: QueryClient, user: User | null) {
  await client.cancelQueries({ queryKey: meKey })
  forgetUserData(client)
  client.setQueryData(meKey, user)
  sessionChannel()?.postMessage(SESSION_CHANGED)
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation<User, ApiError, LoginInput>({
    mutationFn: (input) => login(input),
    onSuccess: (user) => sessionChanged(client, user),
  })
}

export function useSignup() {
  const client = useQueryClient()
  return useMutation<User, ApiError, SignupInput>({
    mutationFn: (input) => signup(input),
    onSuccess: (user) => sessionChanged(client, user),
  })
}

// Logout also ends the user's lab on the server; nothing cached about labs or the
// catalog survives it.
export function useLogout() {
  const client = useQueryClient()
  return useMutation<void, ApiError>({
    mutationFn: () => logout(),
    onSuccess: () => sessionChanged(client, null),
  })
}

// Asks the API again whether the session is valid, e.g. after the terminal was
// refused with 4401. Pages that need a user then send the visitor to login.
export function useRecheckSession(): () => void {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: meKey })
}

// Sessions in other tabs. The session cookie is shared by every tab, so a login,
// sign-up or logout in one changes who the others act as. The tab where it happened
// posts a message with no data; the others drop their user data and ask the API who
// is signed in, showing nothing of the previous user meanwhile. Without
// BroadcastChannel, tabs find out on their next refused request, as before.

const SESSION_CHANNEL = 'linux-lab-session'
const SESSION_CHANGED = 'session-changed'

// One channel per tab: a channel does not receive its own messages, so the tab that
// posted is not reset.
let channel: BroadcastChannel | null | undefined

function sessionChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SESSION_CHANNEL)
  }
  return channel
}

export function useSessionSync() {
  const client = useQueryClient()
  useEffect(() => {
    const current = sessionChannel()
    if (!current) return
    const onMessage = (event: MessageEvent) => {
      if (event.data !== SESSION_CHANGED) return
      // Reset first: the session check becomes pending, so pages stop rendering
      // (and fetching) user data before it is dropped.
      void client.resetQueries({ queryKey: meKey })
      forgetUserData(client)
    }
    current.addEventListener('message', onMessage)
    return () => current.removeEventListener('message', onMessage)
  }, [client])
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
