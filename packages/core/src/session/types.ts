export type SessionStatus = 'open' | 'active' | 'closed'

export interface SessionDeposit {
  paymentHash: string
  preimage: string
  amountSats: number
  settledAt: Date
}

export interface SessionDeduction {
  amountSats: number
  description?: string
  deductedAt: Date
}

export interface SessionState {
  sessionId: string
  status: SessionStatus
  totalDeposited: number
  totalDeducted: number
  balance: number
  deposits: SessionDeposit[]
  deductions: SessionDeduction[]
  createdAt: Date
  updatedAt: Date
}
