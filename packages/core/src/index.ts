// Provider
export type {
  CreateInvoiceParams,
  CreateInvoiceResult,
  LightningProvider,
  LookupInvoiceParams,
  LookupInvoiceResult,
  PayInvoiceParams,
  PayInvoiceResult,
} from "./provider.js";

// Errors
export {
  AuthenticationError,
  ConnectionError,
  InsufficientBalanceError,
  InvoiceExpiredError,
  LightningError,
  PaymentTimeoutError,
  RouteNotFoundError,
} from "./errors.js";
export type { LightningErrorCode } from "./errors.js";

// Preimage & encoding
export {
  base64ToHex,
  bytesToHex,
  hexToBase64Url,
  hexToBytes,
  verifyPreimage,
} from "./preimage.js";

// Store
export { createMemoryStore } from "./store.js";
export type { KeyValueStore } from "./store.js";

// Price Oracle
export type { PriceOracle } from "./price-oracle.js";

// Methods — charge
export {
  lightningCharge,
  lightningChargeClient,
  lightningChargeServer,
} from "./methods/index.js";
export type { LightningChargeClientProgress } from "./methods/index.js";

// Methods — session
export {
  lightningSession,
  lightningSessionClient,
  lightningSessionServer,
} from "./methods/index.js";
export type { LightningSessionClientProgress } from "./methods/index.js";

// Method types
export type {
  LightningChallengeRequest,
  LightningCredentialPayload,
  LightningSessionChallengeRequest,
  LightningSessionCredentialPayload,
} from "./methods/index.js";

// Session state manager (low-level)
export { SessionStateManager } from "./session/index.js";
export type {
  SessionDeduction,
  SessionDeposit,
  SessionState,
  SessionStateManagerOptions,
  SessionStatus,
} from "./session/index.js";
