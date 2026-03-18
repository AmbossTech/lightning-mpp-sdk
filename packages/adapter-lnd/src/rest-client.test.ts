import { describe, expect, it, vi } from 'vitest'
import { createRestTransport } from './rest-client.js'

function mockFetch(response: any, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  })
}

describe('createRestTransport', () => {
  describe('addInvoice', () => {
    it('creates invoice via POST /v1/invoices', async () => {
      // LND REST returns r_hash as base64
      // hex "deadbeef" = base64 "3q2+7w=="
      const fetch = mockFetch({
        r_hash: '3q2+7w==',
        payment_request: 'lnbc1000n1...',
      })

      const transport = createRestTransport({
        transport: 'rest',
        url: 'https://localhost:8080',
        macaroon: 'abcd1234',
        fetch,
      })

      const result = await transport.addInvoice({ value: 1000, memo: 'test' })

      expect(fetch).toHaveBeenCalledWith(
        'https://localhost:8080/v1/invoices',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Grpc-Metadata-macaroon': 'abcd1234',
          }),
        }),
      )
      expect(result.payment_request).toBe('lnbc1000n1...')
      expect(result.r_hash).toBe('deadbeef')
    })
  })

  describe('sendPaymentSync', () => {
    it('pays invoice via POST /v1/channels/transactions', async () => {
      const fetch = mockFetch({
        payment_preimage: '3q2+7w==',
        payment_error: '',
        payment_hash: '3q2+7w==',
      })

      const transport = createRestTransport({
        transport: 'rest',
        url: 'https://localhost:8080',
        macaroon: 'abcd1234',
        fetch,
      })

      const result = await transport.sendPaymentSync({
        payment_request: 'lnbc1000n1...',
        fee_limit: { fixed: 10 },
      })

      expect(result.payment_preimage).toBe('deadbeef')
      expect(result.payment_error).toBe('')
    })
  })

  describe('lookupInvoice', () => {
    it('looks up invoice via GET /v1/invoice/{hash}', async () => {
      const fetch = mockFetch({
        state: 'SETTLED',
        r_preimage: '3q2+7w==',
        value: '1000',
      })

      const transport = createRestTransport({
        transport: 'rest',
        url: 'https://localhost:8080',
        macaroon: 'abcd1234',
        fetch,
      })

      const result = await transport.lookupInvoice({ r_hash_str: 'deadbeef' })

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/invoice/'),
        expect.anything(),
      )
      expect(result.state).toBe('SETTLED')
      expect(result.r_preimage).toBe('deadbeef')
      expect(result.value).toBe('1000')
    })
  })

  describe('error handling', () => {
    it('throws on HTTP error responses', async () => {
      const fetch = mockFetch(
        { message: 'invoice not found', code: 5 },
        404,
      )

      const transport = createRestTransport({
        transport: 'rest',
        url: 'https://localhost:8080',
        macaroon: 'abcd1234',
        fetch,
      })

      await expect(
        transport.lookupInvoice({ r_hash_str: 'deadbeef' }),
      ).rejects.toThrow('invoice not found')
    })

    it('throws ConnectionError on fetch failure', async () => {
      const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

      const transport = createRestTransport({
        transport: 'rest',
        url: 'https://localhost:8080',
        macaroon: 'abcd1234',
        fetch,
      })

      await expect(
        transport.addInvoice({ value: 1000 }),
      ).rejects.toThrow('LND REST request failed')
    })
  })
})
