import { InsufficientBalanceError } from '../errors.js'
import { verifyPreimage } from '../preimage.js'
import type { SessionDeposit, SessionState, SessionStatus } from './types.js'

export interface SessionStateManagerOptions {
  sessionId: string
  onStateChange?: (state: SessionState) => void
}

export class SessionStateManager {
  private state: SessionState

  private readonly onStateChange?: (state: SessionState) => void

  constructor(options: SessionStateManagerOptions) {
    this.onStateChange = options.onStateChange
    this.state = {
      sessionId: options.sessionId,
      status: 'open',
      totalDeposited: 0,
      totalDeducted: 0,
      balance: 0,
      deposits: [],
      deductions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  getState(): SessionState {
    return structuredClone(this.state)
  }

  async deposit(params: {
    preimage: string
    paymentHash: string
    amountSats: number
  }): Promise<SessionState> {
    this.assertStatus('open', 'active')

    const valid = await verifyPreimage(params.preimage, params.paymentHash)
    if (!valid) {
      throw new Error('Invalid preimage for payment hash')
    }

    const deposit: SessionDeposit = {
      paymentHash: params.paymentHash,
      preimage: params.preimage,
      amountSats: params.amountSats,
      settledAt: new Date(),
    }

    this.state.deposits.push(deposit)
    this.state.totalDeposited += params.amountSats
    this.state.balance += params.amountSats
    this.state.updatedAt = new Date()

    this.notify()
    return this.getState()
  }

  deduct(amountSats: number, description?: string): SessionState {
    this.assertStatus('open', 'active')

    if (amountSats > this.state.balance) {
      throw new InsufficientBalanceError(
        `Cannot deduct ${amountSats} sats, balance is ${this.state.balance} sats`,
      )
    }

    this.state.deductions.push({
      amountSats,
      description,
      deductedAt: new Date(),
    })
    this.state.totalDeducted += amountSats
    this.state.balance -= amountSats
    this.state.status = 'active'
    this.state.updatedAt = new Date()

    this.notify()
    return this.getState()
  }

  close(): { refundSats: number; state: SessionState } {
    this.assertStatus('open', 'active')

    const refundSats = this.state.balance
    this.state.status = 'closed'
    this.state.updatedAt = new Date()

    this.notify()
    return { refundSats, state: this.getState() }
  }

  private assertStatus(...allowed: SessionStatus[]): void {
    if (!allowed.includes(this.state.status)) {
      throw new Error(
        `Invalid session status: expected one of [${allowed.join(', ')}], got ${this.state.status}`,
      )
    }
  }

  private notify(): void {
    this.onStateChange?.(this.getState())
  }
}
