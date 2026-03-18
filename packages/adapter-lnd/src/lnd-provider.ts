import type {
  CreateInvoiceParams,
  CreateInvoiceResult,
  LightningProvider,
  LookupInvoiceParams,
  LookupInvoiceResult,
  PayInvoiceParams,
  PayInvoiceResult,
} from "@ambosstech/lightning-mpp-core";
import { createGrpcTransport } from "./grpc-client.js";
import { createRestTransport } from "./rest-client.js";
import { mapLndError } from "./error-mapper.js";
import type { LndConfig, LndTransport } from "./types.js";

export class LndLightningProvider implements LightningProvider {
  private transport: LndTransport;

  constructor(config: LndConfig) {
    this.transport =
      config.transport === "rest"
        ? createRestTransport(config)
        : createGrpcTransport(config);
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    try {
      const response = await this.transport.addInvoice({
        value: params.amountSats,
        memo: params.memo,
        expiry: params.expirySecs,
      });

      return {
        bolt11: response.payment_request,
        paymentHash: response.r_hash,
      };
    } catch (error) {
      throw mapLndError(error);
    }
  }

  async payInvoice(params: PayInvoiceParams): Promise<PayInvoiceResult> {
    try {
      const request: any = { payment_request: params.bolt11 };
      if (params.amountSats !== undefined) {
        request.amt = params.amountSats;
      }
      if (params.maxFeeSats !== undefined) {
        request.fee_limit = { fixed: params.maxFeeSats };
      }

      const response = await this.transport.sendPaymentSync(request);

      if (response.payment_error) {
        throw new Error(response.payment_error);
      }

      return { preimage: response.payment_preimage };
    } catch (error) {
      throw mapLndError(error);
    }
  }

  async lookupInvoice(
    params: LookupInvoiceParams,
  ): Promise<LookupInvoiceResult> {
    try {
      const response = await this.transport.lookupInvoice({
        r_hash_str: params.paymentHash,
      });

      const settled = response.state === "SETTLED";
      return {
        settled,
        preimage: settled ? response.r_preimage : undefined,
        amountSats: response.value ? Number(response.value) : undefined,
      };
    } catch (error) {
      throw mapLndError(error);
    }
  }

  close(): void {
    this.transport.close();
  }
}
