import { describe, expect, it } from 'vitest'
import { mapLndError } from './error-mapper.js'

describe('mapLndError', () => {
  it('maps UNAUTHENTICATED to AuthenticationError', () => {
    const err = mapLndError({ code: 16, details: 'permission denied' })
    expect(err.code).toBe('AUTHENTICATION_ERROR')
  })

  it('maps UNAVAILABLE to ConnectionError', () => {
    const err = mapLndError({ code: 14, details: 'connection refused' })
    expect(err.code).toBe('CONNECTION_ERROR')
  })

  it('maps DEADLINE_EXCEEDED to PaymentTimeoutError', () => {
    const err = mapLndError({ code: 4, details: 'deadline exceeded' })
    expect(err.code).toBe('PAYMENT_TIMEOUT')
  })

  it('maps "invoice expired" to InvoiceExpiredError', () => {
    const err = mapLndError({ code: 2, details: 'invoice expired' })
    expect(err.code).toBe('INVOICE_EXPIRED')
  })

  it('maps "unable to find a path" to RouteNotFoundError', () => {
    const err = mapLndError({ code: 2, details: 'unable to find a path to destination' })
    expect(err.code).toBe('ROUTE_NOT_FOUND')
  })

  it('maps "insufficient balance" to InsufficientBalanceError', () => {
    const err = mapLndError({ code: 2, details: 'insufficient balance' })
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('falls back to ConnectionError for unknown errors', () => {
    const err = mapLndError({ code: 99, details: 'something weird' })
    expect(err.code).toBe('CONNECTION_ERROR')
  })
})
