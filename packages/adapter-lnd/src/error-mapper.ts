import {
  AuthenticationError,
  ConnectionError,
  InsufficientBalanceError,
  InvoiceExpiredError,
  type LightningError,
  PaymentTimeoutError,
  RouteNotFoundError,
} from "@ambosstech/lightning-mpp-core";

interface GrpcError {
  code?: number;
  details?: string;
  message?: string;
}

// gRPC status codes
const UNAVAILABLE = 14;
const UNAUTHENTICATED = 16;
const DEADLINE_EXCEEDED = 4;

export function mapLndError(error: unknown): LightningError {
  const grpcError = error as GrpcError;
  const code = grpcError.code;
  const details = (grpcError.details ?? grpcError.message ?? "").toLowerCase();

  if (code === UNAUTHENTICATED) {
    return new AuthenticationError("LND authentication failed", {
      cause: error,
    });
  }

  if (code === UNAVAILABLE) {
    return new ConnectionError("LND node unavailable", { cause: error });
  }

  if (code === DEADLINE_EXCEEDED) {
    return new PaymentTimeoutError("LND request timed out", { cause: error });
  }

  if (
    details.includes("invoice expired") ||
    details.includes("invoice is expired")
  ) {
    return new InvoiceExpiredError("Invoice has expired", { cause: error });
  }

  if (
    details.includes("unable to find a path") ||
    details.includes("no route") ||
    details.includes("insufficient capacity")
  ) {
    return new RouteNotFoundError("No route found", { cause: error });
  }

  if (
    details.includes("insufficient balance") ||
    details.includes("not enough balance") ||
    details.includes("insufficient funds")
  ) {
    return new InsufficientBalanceError("Insufficient balance", {
      cause: error,
    });
  }

  // Fallback
  return new ConnectionError(
    `LND error: ${grpcError.details ?? grpcError.message ?? "unknown"}`,
    { cause: error },
  );
}
