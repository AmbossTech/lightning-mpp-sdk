export interface NwcConfig {
  /** NWC connection string: nostr+walletconnect://{pubkey}?relay={url}&secret={hex} */
  connectionString: string;
  /** Response timeout in seconds (default: 60) */
  timeoutSecs?: number;
}

export interface NwcConnectionInfo {
  /** Wallet service pubkey (32-byte hex) */
  walletPubkey: string;
  /** Relay URL (wss://...) */
  relayUrl: string;
  /** Client secret / private key (32-byte hex) */
  secret: string;
  /** Optional lightning address */
  lud16?: string;
}

export interface NwcTransport {
  makeInvoice(params: {
    amount: number;
    description?: string;
    expiry?: number;
  }): Promise<{ invoice: string; payment_hash: string }>;

  payInvoice(params: {
    invoice: string;
    amount?: number;
  }): Promise<{ preimage: string }>;

  lookupInvoice(params: {
    payment_hash: string;
  }): Promise<{ settled_at?: number; preimage?: string; amount?: number }>;

  close(): void;
}

/** NWC request event content (kind 23194) */
export interface NwcRequest {
  method: string;
  params: Record<string, unknown>;
}

/** NWC response event content (kind 23195) */
export interface NwcResponse {
  result_type: string;
  error?: {
    code: string;
    message: string;
  };
  result?: Record<string, unknown>;
}
