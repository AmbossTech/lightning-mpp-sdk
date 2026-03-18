import type {
  CreateInvoiceParams,
  CreateInvoiceResult,
  LightningProvider,
  LookupInvoiceParams,
  LookupInvoiceResult,
  PayInvoiceParams,
  PayInvoiceResult,
} from '@ambosstech/lightning-mpp-core'
import { createGrpcClient, type LndGrpcClient } from './grpc-client.js'
import { mapLndError } from './error-mapper.js'
import type { LndConfig } from './types.js'

export class LndLightningProvider implements LightningProvider {
  private client: LndGrpcClient

  constructor(config: LndConfig) {
    this.client = createGrpcClient(config)
  }

  async createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult> {
    try {
      const response = await this.client.addInvoice({
        value: params.amountSats,
        memo: params.memo,
        expiry: params.expirySecs,
      })

      return {
        bolt11: response.payment_request,
        paymentHash: Buffer.from(response.r_hash).toString('hex'),
      }
    } catch (error) {
      throw mapLndError(error)
    }
  }

  async payInvoice(params: PayInvoiceParams): Promise<PayInvoiceResult> {
    try {
      const request: any = { payment_request: params.bolt11 }
      if (params.maxFeeSats !== undefined) {
        request.fee_limit = { fixed: params.maxFeeSats }
      }

      const response = await this.client.sendPaymentSync(request)

      if (response.payment_error) {
        throw new Error(response.payment_error)
      }

      return {
        preimage: Buffer.from(response.payment_preimage).toString('hex'),
      }
    } catch (error) {
      throw mapLndError(error)
    }
  }

  async lookupInvoice(params: LookupInvoiceParams): Promise<LookupInvoiceResult> {
    try {
      const response = await this.client.lookupInvoice({
        r_hash_str: params.paymentHash,
      })

      const settled = response.state === 'SETTLED'
      return {
        settled,
        preimage: settled
          ? Buffer.from(response.r_preimage).toString('hex')
          : undefined,
        amountSats: response.value ? Number(response.value) : undefined,
      }
    } catch (error) {
      throw mapLndError(error)
    }
  }

  close(): void {
    this.client.close()
  }
}
