// An in-memory LockManager for tests, shared by every app rendered in the same test,
// so that two renders behave like two tabs of one browser. It follows the Web Locks
// rules the app relies on: requests are queued in order; an exclusive request is
// granted when nothing holds the name and no earlier request waits for it; a shared
// request is granted when no exclusive lock is held or requested before it; a lock is
// held until the promise returned by its callback settles; an aborted request that was
// not granted yet is removed and rejects with an AbortError.

type Mode = 'shared' | 'exclusive'
type Held = { name: string; mode: Mode }
type Waiting = Held & { start: () => void }
type Options = { mode?: Mode; signal?: AbortSignal }
type Callback = (lock: Held) => unknown

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The request was aborted.', 'AbortError')
}

export class FakeLockManager {
  private held: Held[] = []
  private queue: Waiting[] = []

  request(name: string, optionsOrCallback: Options | Callback, maybeCallback?: Callback) {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    if (!callback) throw new TypeError('callback required')
    const mode = options.mode ?? 'exclusive'
    const { signal } = options
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      const waiting: Waiting = {
        name,
        mode,
        start: () => {
          const lock = { name, mode }
          this.held.push(lock)
          Promise.resolve()
            .then(() => callback(lock))
            .then(
              (value) => {
                this.drop(lock)
                resolve(value)
              },
              (error: unknown) => {
                this.drop(lock)
                reject(error)
              },
            )
        },
      }
      signal?.addEventListener(
        'abort',
        () => {
          const index = this.queue.indexOf(waiting)
          if (index === -1) return
          this.queue.splice(index, 1)
          reject(abortError(signal))
          this.process()
        },
        { once: true },
      )
      this.queue.push(waiting)
      this.process()
    })
  }

  // Names and modes currently held, for assertions.
  holders(name: string): Mode[] {
    return this.held.filter((lock) => lock.name === name).map((lock) => lock.mode)
  }

  waiting(name: string): Mode[] {
    return this.queue.filter((lock) => lock.name === name).map((lock) => lock.mode)
  }

  private grantable(request: Waiting, index: number): boolean {
    const held = this.held.filter((lock) => lock.name === request.name)
    const earlier = this.queue.slice(0, index).filter((lock) => lock.name === request.name)
    if (request.mode === 'exclusive') return held.length === 0 && earlier.length === 0
    return !held.some((lock) => lock.mode === 'exclusive') && !earlier.some((lock) => lock.mode === 'exclusive')
  }

  private process() {
    for (let index = 0; index < this.queue.length; ) {
      const request = this.queue[index]
      if (request && this.grantable(request, index)) {
        this.queue.splice(index, 1)
        request.start()
        index = 0
      } else {
        index += 1
      }
    }
  }

  private drop(lock: Held) {
    this.held.splice(this.held.indexOf(lock), 1)
    this.process()
  }
}
