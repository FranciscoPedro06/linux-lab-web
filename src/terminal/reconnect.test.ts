import { describe, expect, it } from 'vitest'
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from './reconnect.ts'

describe('reconnectDelay', () => {
  it.each([1001, 1006, 1011, 1012])('retries close code %i with exponential backoff', (code) => {
    const delays = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, attempt) =>
      reconnectDelay(code, attempt),
    )
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000])
  })

  it('stops after the maximum number of attempts', () => {
    expect(reconnectDelay(1006, MAX_RECONNECT_ATTEMPTS)).toBeNull()
    expect(reconnectDelay(1006, 50)).toBeNull()
  })

  it.each([
    [4401, 'session expired: sign in again'],
    [4404, 'lab not found'],
    [4410, 'lab ended'],
    [4409, 'taken by another tab'],
    [4000, 'shell exited'],
    [1000, 'closed on purpose'],
    [1008, 'protocol error'],
    [1009, 'message too big'],
  ])('never retries close code %i (%s)', (code) => {
    expect(reconnectDelay(code, 0)).toBeNull()
  })

  it('does not retry without a close code', () => {
    expect(reconnectDelay(undefined, 0)).toBeNull()
  })
})
