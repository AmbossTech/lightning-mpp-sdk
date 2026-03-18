export interface LndGrpcConfig {
  transport: "grpc";
  /** LND gRPC host:port, e.g. "127.0.0.1:10009" */
  host: string;
  /** TLS certificate as PEM string or raw bytes */
  tlsCert: string | Buffer;
  /** Admin macaroon as hex string or raw bytes */
  macaroon: string | Buffer;
}

export interface LndRestConfig {
  transport: "rest";
  /** LND REST URL, e.g. "https://127.0.0.1:8080" */
  url: string;
  /** Admin macaroon as hex string or raw bytes */
  macaroon: string | Buffer;
  /** Optional: custom fetch for environments that need TLS cert handling */
  fetch?: typeof globalThis.fetch;
}

export type LndConfig = LndGrpcConfig | LndRestConfig;

/** Internal transport interface shared by gRPC and REST clients */
export interface LndTransport {
  addInvoice(params: {
    value: number;
    memo?: string;
    expiry?: number;
  }): Promise<{ r_hash: string; payment_request: string }>;

  sendPaymentSync(params: {
    payment_request: string;
    fee_limit?: { fixed: number };
  }): Promise<{
    payment_preimage: string;
    payment_error: string;
    payment_hash: string;
  }>;

  lookupInvoice(params: { r_hash_str: string }): Promise<{
    state: string;
    r_preimage: string;
    value: string;
  }>;

  close(): void;
}
