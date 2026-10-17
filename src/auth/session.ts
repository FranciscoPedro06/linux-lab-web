import {
  hashKey,
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
// True while another tab is changing the session (login, sign-up or logout): until it
// is over and the API confirmed who is signed in, nothing private is shown.
const transitionKey = ['auth', 'transition'] as const

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous' }
  | { status: 'error'; message: string; retry: () => void }

export function useAuth(): AuthState {
  const query = useQuery({ queryKey: meKey, queryFn: () => fetchMe() })
  const transition = useQuery({
    queryKey: transitionKey,
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
  })
  if (transition.data || query.isPending) return { status: 'loading' }
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
// cancelled so that its answer cannot replace the new user.
async function sessionChanged(client: QueryClient, user: User | null) {
  await client.cancelQueries({ queryKey: meKey })
  forgetUserData(client)
  client.setQueryData(meKey, user)
  announce(SESSION_CHANGED)
}

// Login, sign-up and logout tell the other tabs before their request is sent, since
// the shared cookie changes as soon as the answer arrives, and again once it is known
// whether the session changed.
function useSessionMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  user: (data: TData) => User | null,
) {
  const client = useQueryClient()
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onMutate: () => announce(SESSION_CHANGING),
    onSuccess: (data) => sessionChanged(client, user(data)),
    onError: () => announce(SESSION_UNCHANGED),
  })
}

export function useLogin() {
  return useSessionMutation<User, LoginInput>((input) => login(input), (user) => user)
}

export function useSignup() {
  return useSessionMutation<User, SignupInput>((input) => signup(input), (user) => user)
}

// Logout also ends the user's lab on the server; nothing cached about labs or the
// catalog survives it.
export function useLogout() {
  return useSessionMutation<void, void>(
    () => logout(),
    () => null,
  )
}

// Asks the API again whether the session is valid, e.g. after the terminal was
// refused with 4401. Pages that need a user then send the visitor to login.
export function useRecheckSession(): () => void {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: meKey })
}

// Who the cache belongs to, and other tabs.
//
// The session cookie is HttpOnly and shared by every tab, so a tab learns that the
// signed-in user changed only from the API or from another tab. Two rules apply:
//
// - Owner: the labs and catalog cached belong to the user of the last answered
//   session check. When a session check answers with another user, or with none,
//   they are dropped before anything renders with the new answer.
// - Other tabs: with BroadcastChannel, the tab that logs in, signs up or logs out
//   posts `changing` before its request and `changed` or `unchanged` after it; the
//   messages carry no data. On `changing` the other tabs hide everything private.
//   On `changed` they drop their labs and catalog; on either answer they ask the API
//   who is signed in and show private pages again only once it answers. If no answer
//   comes (the tab was closed mid-request), they ask after TRANSITION_TIMEOUT_MS.
// - Without BroadcastChannel, a tab that becomes visible hides everything private
//   until the API confirms who is signed in, and a visible tab asks every
//   SESSION_CHECK_MS. A tab left visible next to another where the user changed can
//   show the previous user's data for at most that long.

const SESSION_CHANNEL = 'linux-lab-session'
const SESSION_CHANGING = 'session-changing'
const SESSION_CHANGED = 'session-changed'
const SESSION_UNCHANGED = 'session-unchanged'
export const TRANSITION_TIMEOUT_MS = 30_000
export const SESSION_CHECK_MS = 15_000

type SessionMessage = typeof SESSION_CHANGING | typeof SESSION_CHANGED | typeof SESSION_UNCHANGED

// This tab's channel while the app is mounted. A channel does not receive its own
// messages, so the tab that posts is not reset by them.
let channel: BroadcastChannel | null = null

function announce(message: SessionMessage) {
  channel?.postMessage(message)
}

export function useSessionSync() {
  const client = useQueryClient()
  useEffect(() => {
    const cleanups: (() => void)[] = []

    // Owner of the cached labs and catalog.
    const meHash = hashKey(meKey)
    const userOf = (data: unknown) => (data as User | null | undefined)?.id ?? null
    const known = client.getQueryState(meKey)
    let owner = known?.status === 'success' ? userOf(known.data) : undefined
    cleanups.push(
      client.getQueryCache().subscribe((event) => {
        const { queryHash, state } = event.query
        if (queryHash !== meHash || state.status !== 'success') return
        const user = userOf(state.data)
        if (owner !== undefined && user !== owner) forgetUserData(client)
        owner = user
      }),
    )

    // Ask the API who is signed in, showing nothing private until it answers. An
    // answer for a request sent before is discarded.
    const revalidate = () => void client.resetQueries({ queryKey: meKey })

    if (typeof BroadcastChannel !== 'undefined') {
      const current = new BroadcastChannel(SESSION_CHANNEL)
      channel = current
      let timeout: ReturnType<typeof setTimeout> | undefined
      const endTransition = () => {
        clearTimeout(timeout)
        revalidate()
        client.setQueryData(transitionKey, false)
      }
      current.onmessage = (event: MessageEvent) => {
        if (event.data === SESSION_CHANGING) {
          client.setQueryData(transitionKey, true)
          clearTimeout(timeout)
          timeout = setTimeout(endTransition, TRANSITION_TIMEOUT_MS)
        } else if (event.data === SESSION_CHANGED) {
          endTransition()
          forgetUserData(client)
        } else if (event.data === SESSION_UNCHANGED) {
          endTransition()
        }
      }
      cleanups.push(() => {
        clearTimeout(timeout)
        current.close()
        if (channel === current) channel = null
      })
    } else {
      const onVisibility = () => {
        if (document.visibilityState === 'visible') revalidate()
      }
      document.addEventListener('visibilitychange', onVisibility)
      const interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void client.refetchQueries({ queryKey: meKey })
        }
      }, SESSION_CHECK_MS)
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onVisibility)
        clearInterval(interval)
      })
    }

    return () => cleanups.forEach((cleanup) => cleanup())
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
