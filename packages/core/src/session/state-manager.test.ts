import { describe, expect, it, vi } from 'vitest'
import { InsufficientBalanceError } from '../errors.js'
import { bytesToHex } from '../preimage.js'
import { SessionStateManager } from './state-manager.js'

async function makePreimageAndHash(seed: number) {
  const preimageBytes = new Uint8Array(32)
  preimageBytes[0] = seed
  const preimage = bytesToHex(preimageBytes)
  const hashBuffer = await crypto.subtle.digest('SHA-256', preimageBytes)
  const paymentHash = bytesToHex(new Uint8Array(hashBuffer))
  return { preimage, paymentHash }
}

describe('SessionStateManager', () => {
  it('initializes with open status and zero balance', () => {
    const mgr = new SessionStateManager({ sessionId: 'test-1' })
    const state = mgr.getState()
    expect(state.sessionId).toBe('test-1')
    expect(state.status).toBe('open')
    expect(state.balance).toBe(0)
    expect(state.totalDeposited).toBe(0)
    expect(state.totalDeducted).toBe(0)
  })

  it('accepts deposits with valid preimage', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-2' })
    const { preimage, paymentHash } = await makePreimageAndHash(1)

    const state = await mgr.deposit({ preimage, paymentHash, amountSats: 1000 })
    expect(state.balance).toBe(1000)
    expect(state.totalDeposited).toBe(1000)
    expect(state.deposits).toHaveLength(1)
  })

  it('rejects deposits with invalid preimage', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-3' })
    const { paymentHash } = await makePreimageAndHash(1)
    const wrongPreimage = '0000000000000000000000000000000000000000000000000000000000000099'

    await expect(
      mgr.deposit({ preimage: wrongPreimage, paymentHash, amountSats: 1000 }),
    ).rejects.toThrow('Invalid preimage')
  })

  it('deducts from balance', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-4' })
    const { preimage, paymentHash } = await makePreimageAndHash(2)
    await mgr.deposit({ preimage, paymentHash, amountSats: 1000 })

    const state = mgr.deduct(400, 'api call')
    expect(state.balance).toBe(600)
    expect(state.totalDeducted).toBe(400)
    expect(state.status).toBe('active')
  })

  it('throws InsufficientBalanceError when deducting more than balance', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-5' })
    const { preimage, paymentHash } = await makePreimageAndHash(3)
    await mgr.deposit({ preimage, paymentHash, amountSats: 100 })

    expect(() => mgr.deduct(200)).toThrow(InsufficientBalanceError)
  })

  it('closes session and returns refund amount', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-6' })
    const { preimage, paymentHash } = await makePreimageAndHash(4)
    await mgr.deposit({ preimage, paymentHash, amountSats: 1000 })
    mgr.deduct(300)

    const { refundSats, state } = mgr.close()
    expect(refundSats).toBe(700)
    expect(state.status).toBe('closed')
  })

  it('prevents operations on closed sessions', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-7' })
    const { preimage, paymentHash } = await makePreimageAndHash(5)
    await mgr.deposit({ preimage, paymentHash, amountSats: 100 })
    mgr.close()

    await expect(
      mgr.deposit({ preimage, paymentHash, amountSats: 100 }),
    ).rejects.toThrow('Invalid session status')
    expect(() => mgr.deduct(10)).toThrow('Invalid session status')
  })

  it('calls onStateChange callback', async () => {
    const onChange = vi.fn()
    const mgr = new SessionStateManager({ sessionId: 'test-8', onStateChange: onChange })
    const { preimage, paymentHash } = await makePreimageAndHash(6)

    await mgr.deposit({ preimage, paymentHash, amountSats: 500 })
    expect(onChange).toHaveBeenCalledTimes(1)

    mgr.deduct(100)
    expect(onChange).toHaveBeenCalledTimes(2)

    mgr.close()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('returns deep copies from getState', async () => {
    const mgr = new SessionStateManager({ sessionId: 'test-9' })
    const { preimage, paymentHash } = await makePreimageAndHash(7)
    await mgr.deposit({ preimage, paymentHash, amountSats: 500 })

    const state1 = mgr.getState()
    const state2 = mgr.getState()
    expect(state1).toEqual(state2)
    expect(state1).not.toBe(state2)
    expect(state1.deposits).not.toBe(state2.deposits)
  })
})
