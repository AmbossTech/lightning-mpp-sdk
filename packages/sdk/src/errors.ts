export type LightningErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "INVOICE_EXPIRED"
  | "ROUTE_NOT_FOUND"
  | "PAYMENT_TIMEOUT"
  | "CONNECTION_ERROR"
  | "AUTHENTICATION_ERROR";

export class LightningError extends Error {
  readonly code: LightningErrorCode;

  constructor(
    code: LightningErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LightningError";
    this.code = code;
  }
}

export class InsufficientBalanceError extends LightningError {
  constructor(message = "Insufficient balance", options?: ErrorOptions) {
    super("INSUFFICIENT_BALANCE", message, options);
    this.name = "InsufficientBalanceError";
  }
}

export class InvoiceExpiredError extends LightningError {
  constructor(message = "Invoice has expired", options?: ErrorOptions) {
    super("INVOICE_EXPIRED", message, options);
    this.name = "InvoiceExpiredError";
  }
}

export class RouteNotFoundError extends LightningError {
  constructor(
    message = "No route found to destination",
    options?: ErrorOptions,
  ) {
    super("ROUTE_NOT_FOUND", message, options);
    this.name = "RouteNotFoundError";
  }
}

export class PaymentTimeoutError extends LightningError {
  constructor(message = "Payment timed out", options?: ErrorOptions) {
    super("PAYMENT_TIMEOUT", message, options);
    this.name = "PaymentTimeoutError";
  }
}

export class ConnectionError extends LightningError {
  constructor(message = "Connection failed", options?: ErrorOptions) {
    super("CONNECTION_ERROR", message, options);
    this.name = "ConnectionError";
  }
}

export class AuthenticationError extends LightningError {
  constructor(message = "Authentication failed", options?: ErrorOptions) {
    super("AUTHENTICATION_ERROR", message, options);
    this.name = "AuthenticationError";
  }
}
