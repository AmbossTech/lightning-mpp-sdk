export interface LightningCredentialPayload {
  preimage: string
}

export interface LightningChallengeRequest {
  invoice: string
  paymentHash: string
  amount: string
  currency: string
  recipient: string
}
