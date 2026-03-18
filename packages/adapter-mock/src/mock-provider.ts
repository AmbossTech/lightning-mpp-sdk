import { createHash } from "node:crypto";
import type {
  CreateInvoiceParams,
  CreateInvoiceResult,
  LightningProvider,
  LookupInvoiceParams,
  LookupInvoiceResult,
  PayInvoiceParams,
  PayInvoiceResult,
} from "@ambosstech/lightning-mpp-sdk";
import {
  InvoiceExpiredError,
  RouteNotFoundError,
} from "@ambosstech/lightning-mpp-sdk";

export interface MockProviderOptions {
  autoSettle?: boolean;
  failOnPay?: boolean;
  paymentDelay?: number;
}

interface StoredInvoice {
  bolt11: string;
  paymentHash: string;
  preimage: string;
  amountSats: number;
  settled: boolean;
  memo?: string;
}

export class MockLightningProvider implements LightningProvider {
  private invoices = new Map<string, StoredInvoice>();
  private counter = 0;

  private readonly autoSettle: boolean;
  private readonly failOnPay: boolean;
  private readonly paymentDelay: number;

  constructor(options: MockProviderOptions = {}) {
    this.autoSettle = options.autoSettle ?? true;
    this.failOnPay = options.failOnPay ?? false;
    this.paymentDelay = options.paymentDelay ?? 0;
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    this.counter++;
    const preimageBytes = Buffer.alloc(32);
    preimageBytes.writeUInt32BE(this.counter, 0);
    const preimage = preimageBytes.toString("hex");

    const paymentHash = createHash("sha256")
      .update(preimageBytes)
      .digest("hex");

    const bolt11 = `lnbcrt${params.amountSats}n1mock${paymentHash.slice(0, 16)}`;

    this.invoices.set(paymentHash, {
      bolt11,
      paymentHash,
      preimage,
      amountSats: params.amountSats,
      settled: false,
      memo: params.memo,
    });

    return { bolt11, paymentHash };
  }

  async payInvoice(params: PayInvoiceParams): Promise<PayInvoiceResult> {
    if (this.failOnPay) {
      throw new RouteNotFoundError("Mock: configured to fail on pay");
    }

    if (this.paymentDelay > 0) {
      await new Promise((r) => setTimeout(r, this.paymentDelay));
    }

    // Find the invoice by bolt11
    const invoice = [...this.invoices.values()].find(
      (inv) => inv.bolt11 === params.bolt11,
    );

    if (!invoice) {
      throw new InvoiceExpiredError("Mock: invoice not found");
    }

    if (this.autoSettle) {
      invoice.settled = true;
    }

    return { preimage: invoice.preimage };
  }

  async lookupInvoice(
    params: LookupInvoiceParams,
  ): Promise<LookupInvoiceResult> {
    const invoice = this.invoices.get(params.paymentHash);
    if (!invoice) {
      return { settled: false };
    }
    return {
      settled: invoice.settled,
      preimage: invoice.settled ? invoice.preimage : undefined,
      amountSats: invoice.amountSats,
    };
  }

  // Test helpers

  settleInvoice(paymentHash: string): void {
    const invoice = this.invoices.get(paymentHash);
    if (invoice) {
      invoice.settled = true;
    }
  }

  getInvoices(): StoredInvoice[] {
    return [...this.invoices.values()];
  }

  reset(): void {
    this.invoices.clear();
    this.counter = 0;
  }
}
