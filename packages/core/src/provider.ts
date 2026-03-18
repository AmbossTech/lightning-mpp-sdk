export interface CreateInvoiceParams {
  amountSats: number
  memo?: string
  expirySecs?: number
}

export interface CreateInvoiceResult {
  bolt11: string
  paymentHash: string
}

export interface PayInvoiceParams {
  bolt11: string
  maxFeeSats?: number
  timeoutSecs?: number
}

export interface PayInvoiceResult {
  preimage: string
}

export interface LookupInvoiceParams {
  paymentHash: string
}

export interface LookupInvoiceResult {
  settled: boolean
  preimage?: string
  amountSats?: number
}

export interface LightningProvider {
  createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult>
  payInvoice(params: PayInvoiceParams): Promise<PayInvoiceResult>
  lookupInvoice(params: LookupInvoiceParams): Promise<LookupInvoiceResult>
}
