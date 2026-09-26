import { afterEach, describe, expect, it, vi } from 'vitest'
import { consentRequest } from '../parent-consent-withdrawal'

afterEach(() => { vi.useRealTimers() })
describe('consent operation recovery deadline', () => {
  it('stops waiting at 20 seconds and aborts the operation signal', async () => {
    vi.useFakeTimers()
    const request = new AbortController()
    const result = consentRequest(request, () => new Promise(() => {}))
    const rejected = expect(result).rejects.toHaveProperty('name', 'AbortError')
    await vi.advanceTimersByTimeAsync(19_999)
    expect(request.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(request.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels a hung SDK lookup on unmount without waiting for its timeout', async () => {
    const request = new AbortController()
    const result = consentRequest(request, () => new Promise(() => {}))
    const rejected = expect(result).rejects.toHaveProperty('name', 'AbortError')
    request.abort(); await rejected
  })
  it('cleans up the deadline after a successful request', async () => {
    vi.useFakeTimers()
    const request = new AbortController()
    expect(await consentRequest(request, async () => 1)).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(request.signal.aborted).toBe(false)
  })
  it('never starts a request that has already been cancelled', async () => {
    const request = new AbortController(); request.abort()
    const action = vi.fn(async () => 1)
    await expect(consentRequest(request, action)).rejects.toHaveProperty('name', 'AbortError')
    expect(action).not.toHaveBeenCalled()
  })
})
