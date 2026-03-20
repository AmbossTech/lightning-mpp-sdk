import type {
  CreateInvoiceParams,
  CreateInvoiceResult,
  LightningProvider,
  LookupInvoiceParams,
  LookupInvoiceResult,
  PayInvoiceParams,
  PayInvoiceResult,
} from "@ambosstech/lightning-mpp-sdk";
import { parseConnectionString } from "./connection-string.js";
import { createNwcTransport } from "./nwc-client.js";
import type { NwcConfig, NwcTransport } from "./types.js";

export class NwcLightningProvider implements LightningProvider {
  private transport: NwcTransport;

  constructor(config: NwcConfig) {
    const info = parseConnectionString(config.connectionString);
    this.transport = createNwcTransport(info, {
      timeoutSecs: config.timeoutSecs,
    });
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    const response = await this.transport.makeInvoice({
      amount: params.amountSats * 1000, // sats → msats
      description: params.memo,
      expiry: params.expirySecs,
    });

    return {
      bolt11: response.invoice,
      paymentHash: response.payment_hash,
    };
  }

  async payInvoice(params: PayInvoiceParams): Promise<PayInvoiceResult> {
    if (params.maxFeeSats !== undefined) {
      console.warn(
        "NWC does not support maxFeeSats — fee limits are controlled by the wallet",
      );
    }

    const response = await this.transport.payInvoice({
      invoice: params.bolt11,
      amount:
        params.amountSats !== undefined
          ? params.amountSats * 1000 // sats → msats
          : undefined,
    });

    return { preimage: response.preimage };
  }

  async lookupInvoice(
    params: LookupInvoiceParams,
  ): Promise<LookupInvoiceResult> {
    const response = await this.transport.lookupInvoice({
      payment_hash: params.paymentHash,
    });

    return {
      settled: response.settled_at !== undefined && response.settled_at !== null,
      preimage: response.preimage,
      amountSats:
        response.amount !== undefined
          ? Math.floor(response.amount / 1000) // msats → sats
          : undefined,
    };
  }

  close(): void {
    this.transport.close();
  }
}
