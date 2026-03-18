import { verifyPreimage } from '@ambosstech/lightning-mpp-core'
import { describe, expect, it } from 'vitest'
import { MockLightningProvider } from './mock-provider.js'

describe('MockLightningProvider', () => {
  it('creates invoices with valid preimage/hash pairs', async () => {
    const provider = new MockLightningProvider()
    const { bolt11, paymentHash } = await provider.createInvoice({ amountSats: 1000 })

    expect(bolt11).toContain('lnbcrt')
    expect(paymentHash).toHaveLength(64)
  })

  it('pays invoices and returns valid preimage', async () => {
    const provider = new MockLightningProvider()
    const { bolt11, paymentHash } = await provider.createInvoice({ amountSats: 1000 })
    const { preimage } = await provider.payInvoice({ bolt11 })

    expect(await verifyPreimage(preimage, paymentHash)).toBe(true)
  })

  it('settles invoices on pay when autoSettle is true', async () => {
    const provider = new MockLightningProvider({ autoSettle: true })
    const { bolt11, paymentHash } = await provider.createInvoice({ amountSats: 500 })
    await provider.payInvoice({ bolt11 })

    const lookup = await provider.lookupInvoice({ paymentHash })
    expect(lookup.settled).toBe(true)
    expect(lookup.preimage).toBeDefined()
  })

  it('does not settle invoices when autoSettle is false', async () => {
    const provider = new MockLightningProvider({ autoSettle: false })
    const { bolt11, paymentHash } = await provider.createInvoice({ amountSats: 500 })
    await provider.payInvoice({ bolt11 })

    const lookup = await provider.lookupInvoice({ paymentHash })
    expect(lookup.settled).toBe(false)

    provider.settleInvoice(paymentHash)
    const lookup2 = await provider.lookupInvoice({ paymentHash })
    expect(lookup2.settled).toBe(true)
  })

  it('throws RouteNotFoundError when failOnPay is true', async () => {
    const provider = new MockLightningProvider({ failOnPay: true })
    const { bolt11 } = await provider.createInvoice({ amountSats: 100 })

    await expect(provider.payInvoice({ bolt11 })).rejects.toThrow('configured to fail')
  })

  it('returns not-settled for unknown payment hash', async () => {
    const provider = new MockLightningProvider()
    const lookup = await provider.lookupInvoice({ paymentHash: 'deadbeef'.repeat(8) })
    expect(lookup.settled).toBe(false)
  })

  it('resets state', async () => {
    const provider = new MockLightningProvider()
    await provider.createInvoice({ amountSats: 100 })
    expect(provider.getInvoices()).toHaveLength(1)

    provider.reset()
    expect(provider.getInvoices()).toHaveLength(0)
  })
})
