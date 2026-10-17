import { hashKey, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, fetchMe, type User } from './api.ts'
import styles from './Auth.module.css'

// Tabs of one browser share the session cookie, so a login, sign-up or logout in one
// changes who every other tab acts as. This module coordinates them so that no tab
// shows one user's data while the session belongs to another.
//
// Rule: a tab shows private pages only while it holds the `linux-lab-session` Web
// Lock in shared mode, and only after asking the API who is signed in since it took
// the lock. A session change (login, sign-up, logout) runs while holding the same lock
// in exclusive mode, which the browser grants only when no tab holds it shared, that
// is, when no tab shows private pages. So while the cookie changes, every tab is hidden.
//
// 1. The tab that changes the session hides its own pages, releases its shared lock,
//    requests the exclusive lock and posts `session-changing` on the
//    `linux-lab-session` BroadcastChannel.
// 2. On that message, the other tabs hide their private pages and release their
//    shared lock. Hidden tabs (in the background) have already released it.
// 3. Once the exclusive lock is granted, the request is sent; its result goes into the
//    cache and `session-changed` (or `session-unchanged` if it failed) is posted.
//    The exclusive lock is then released.
// 4. Every tab takes the shared lock again, asks the API who is signed in and only
//    then shows private pages: for the new user, with the previous user's cache
//    dropped, or for the same user after a failed attempt.
//
// If the exclusive lock is not granted within COORDINATION_TIMEOUT_MS (a visible tab
// that does not answer), the change is refused: nothing is sent, the other tabs are
// told it did not happen and check the session again. A tab told that a change
// started but never told how it ended checks again after RECOVERY_MS, still behind the
// lock. Messages and lock grants can be delayed; none of the steps depends on timing,
// only liveness does.
//
// Browsers without Web Locks or BroadcastChannel cannot take part. There, signing in
// and signing up are refused, so no other user can ever be signed in on them; logging
// out is allowed, since it leaves no user whose data could be shown.

const LOCK = 'linux-lab-session'
const CHANNEL = 'linux-lab-session'
const CHANGING = 'session-changing'
const CHANGED = 'session-changed'
const UNCHANGED = 'session-unchanged'
export const COORDINATION_TIMEOUT_MS = 5_000
export const RECOVERY_MS = 60_000

const meKey = ['auth', 'me'] as const

const BUSY_MESSAGE =
  'Outra aba do Linux Lab não liberou a sessão. Feche ou atualize as outras abas e tente novamente.'
const UNSUPPORTED_MESSAGE =
  'Este navegador não permite trocar de conta com segurança entre abas. Atualize o navegador para entrar.'

function lockManager(): LockManager | null {
  return typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks
    ? navigator.locks
    : null
}

export function sessionChangeSupported(): boolean {
  return lockManager() !== null && typeof BroadcastChannel !== 'undefined'
}

// Labs and the catalog (which carries the user's progress) belong to one user.
export function forgetUserData(client: QueryClient) {
  client.removeQueries({ queryKey: ['labs'] })
  client.removeQueries({ queryKey: ['catalog'] })
}

class TabSession {
  private channel: BroadcastChannel | null = null
  private release: (() => void) | null = null
  private pending: AbortController | null = null
  private recovery: ReturnType<typeof setTimeout> | undefined
  private switching = false
  private stops: (() => void)[] = []

  constructor(
    private readonly client: QueryClient,
    private readonly setVeiled: (veiled: boolean) => void,
  ) {}

  start() {
    // The cached labs and catalog belong to the user of the last answered session
    // check; an answer naming someone else, or nobody, drops them before anything
    // renders with it.
    const meHash = hashKey(meKey)
    const userOf = (data: unknown) => (data as User | null | undefined)?.id ?? null
    const known = this.client.getQueryState(meKey)
    let owner = known?.status === 'success' ? userOf(known.data) : undefined
    this.stops.push(
      this.client.getQueryCache().subscribe((event) => {
        const { queryHash, state } = event.query
        if (queryHash !== meHash || state.status !== 'success') return
        const user = userOf(state.data)
        if (owner !== undefined && user !== owner) forgetUserData(this.client)
        owner = user
      }),
    )

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (event: MessageEvent) => this.onMessage(event.data)
      this.channel = channel
      this.stops.push(() => channel.close())
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void this.resume()
      else this.hide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.stops.push(() => document.removeEventListener('visibilitychange', onVisibility))

    void this.resume()
  }

  stop() {
    clearTimeout(this.recovery)
    this.unlock()
    this.stops.forEach((stop) => stop())
    this.stops = []
    this.channel = null
  }

  // Runs a session change (login, sign-up, logout) under the exclusive lock. With
  // `withoutOtherTabs`, a browser that cannot coordinate runs it anyway (logout).
  async change<T>(run: () => Promise<T>, withoutOtherTabs = false): Promise<T> {
    const locks = lockManager()
    if (!locks || !this.channel) {
      if (!withoutOtherTabs) throw new ApiError(0, 'unsupported_browser', UNSUPPORTED_MESSAGE)
      return run()
    }
    this.switching = true
    this.hide()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), COORDINATION_TIMEOUT_MS)
    let granted = false
    try {
      const result = locks.request(LOCK, { mode: 'exclusive', signal: controller.signal }, async () => {
        granted = true
        clearTimeout(timer)
        try {
          const value = await run()
          this.post(CHANGED)
          return value
        } catch (error) {
          this.post(UNCHANGED)
          throw error
        }
      }) as Promise<T>
      this.post(CHANGING)
      return await result
    } catch (error) {
      if (granted) throw error
      this.post(UNCHANGED)
      throw new ApiError(0, 'session_busy', BUSY_MESSAGE)
    } finally {
      clearTimeout(timer)
      this.switching = false
      void this.resume()
    }
  }

  private onMessage(message: unknown) {
    if (message === CHANGING) {
      this.hide()
      clearTimeout(this.recovery)
      this.recovery = setTimeout(() => void this.resume(), RECOVERY_MS)
    } else if (message === CHANGED || message === UNCHANGED) {
      clearTimeout(this.recovery)
      this.hide()
      if (message === CHANGED) forgetUserData(this.client)
      void this.resume()
    }
  }

  private post(message: string) {
    this.channel?.postMessage(message)
  }

  // Hides private pages and gives up the shared lock, or a request for it. The pages
  // are hidden in the DOM before the lock is released: once it is free, a session
  // change may start.
  private hide() {
    flushSync(() => this.setVeiled(true))
    this.unlock()
  }

  private unlock() {
    this.pending?.abort()
    this.pending = null
    this.release?.()
    this.release = null
  }

  // Takes the shared lock (waiting while a session change runs), asks the API who is
  // signed in, and only then shows private pages. Anything that hides them meanwhile
  // cancels this.
  private async resume() {
    if (this.switching || document.visibilityState !== 'visible') return
    this.unlock()
    const controller = new AbortController()
    this.pending = controller
    const locks = lockManager()
    if (locks) {
      try {
        await new Promise<void>((granted, failed) => {
          locks
            .request(LOCK, { mode: 'shared', signal: controller.signal }, () => {
              granted()
              return new Promise<void>((released) => {
                this.release = released
              })
            })
            .catch(failed)
        })
      } catch {
        return
      }
    }
    if (controller.signal.aborted) return
    await this.client.refetchQueries({ queryKey: meKey })
    if (controller.signal.aborted) return
    this.pending = null
    this.setVeiled(false)
  }
}

const TabSessionContext = createContext<TabSession | null>(null)

// Runs a session change in coordination with the other tabs.
export function useSessionChange(): TabSession['change'] {
  const session = useContext(TabSessionContext)
  if (!session) throw new Error('useSessionChange outside SessionTabs')
  return (run, withoutOtherTabs) => session.change(run, withoutOtherTabs)
}

// Wraps the pages: they stay mounted (an open terminal keeps its connection) but are
// hidden while this tab may not show private data. Only pages of a signed-in user
// hold private data; login, sign-up and loading pages are never hidden.
export function SessionTabs({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [veiled, setVeiled] = useState(true)
  const [session] = useState(() => new TabSession(client, setVeiled))
  const user = useQuery({ queryKey: meKey, queryFn: () => fetchMe() }).data
  const hidden = veiled && Boolean(user)

  useEffect(() => {
    session.start()
    return () => session.stop()
  }, [session])

  return (
    <TabSessionContext.Provider value={session}>
      <div hidden={hidden}>{children}</div>
      {hidden && (
        <p className={styles.muted} role="status">
          Carregando…
        </p>
      )}
    </TabSessionContext.Provider>
  )
}
