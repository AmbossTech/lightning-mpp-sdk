export interface LndConfig {
  /** LND gRPC host:port, e.g. "127.0.0.1:10009" */
  host: string
  /** TLS certificate as PEM string or raw bytes */
  tlsCert: string | Buffer
  /** Admin macaroon as hex string or raw bytes */
  macaroon: string | Buffer
}
