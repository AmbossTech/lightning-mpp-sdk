/** Credential payload for charge method */
export interface LightningCredentialPayload {
  preimage: string;
}

/** Challenge request for charge method (matches Spark wire format) */
export interface LightningChallengeRequest {
  amount: string;
  currency?: string;
  description?: string;
  methodDetails: {
    invoice: string;
    paymentHash?: string;
    network?: string;
  };
}

/** Session credential payload — discriminated union by action */
export type LightningSessionCredentialPayload =
  | { action: "open"; preimage: string; returnInvoice: string }
  | { action: "bearer"; sessionId: string; preimage: string }
  | { action: "topUp"; sessionId: string; topUpPreimage: string }
  | { action: "close"; sessionId: string; preimage: string };

/** Challenge request for session method */
export interface LightningSessionChallengeRequest {
  amount: string;
  currency: string;
  description?: string;
  unitType?: string;
  depositInvoice?: string;
  paymentHash: string;
  depositAmount?: string;
  idleTimeout?: string;
}
