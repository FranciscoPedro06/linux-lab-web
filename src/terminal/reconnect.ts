// When a closed terminal connection may be reopened automatically.
//
// Only failures of the connection itself are retried: the network dropped (1006),
// the server restarted or went away (1001, 1012), or the runtime failed (1011).
// Everything else needs the user or the lab's state to change first:
//
// - 4401: the session is gone; the user must sign in again.
// - 4404, 4410: the lab is not there or has ended; the API says what happened.
// - 4409: another tab took the terminal; taking it back is the user's choice.
// - 4000: the shell exited; a new shell is the user's choice.
// - 1000, 1008, 1009: closed on purpose, or a client bug that a retry would repeat.
//
// Before each retry the page asks the API for the lab's state and reconnects only
// if the lab is still ready, so the backend stays the authority on the lifecycle.

export const MAX_RECONNECT_ATTEMPTS = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 16000

const retryable = new Set([1001, 1006, 1011, 1012, 1013, 1014])

// Delay before reconnect attempt number `attempt` (0 for the first), or null if the
// connection should not be reopened automatically.
export function reconnectDelay(code: number | undefined, attempt: number): number | null {
  if (code === undefined || !retryable.has(code)) return null
  if (attempt >= MAX_RECONNECT_ATTEMPTS) return null
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
}
