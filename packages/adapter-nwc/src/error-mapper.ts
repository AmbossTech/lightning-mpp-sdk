import {
  AuthenticationError,
  ConnectionError,
  InsufficientBalanceError,
  InvoiceExpiredError,
  type LightningError,
  PaymentTimeoutError,
  RouteNotFoundError,
} from "@ambosstech/lightning-mpp-sdk";
import type { NwcResponse } from "./types.js";

export function mapNwcError(response: NwcResponse): LightningError {
  const code = response.error?.code ?? "OTHER";
  const message = (response.error?.message ?? "").toLowerCase();

  switch (code) {
    case "INSUFFICIENT_BALANCE":
      return new InsufficientBalanceError("Insufficient balance", {
        cause: response.error,
      });

    case "PAYMENT_FAILED":
      if (message.includes("expired")) {
        return new InvoiceExpiredError("Invoice has expired", {
          cause: response.error,
        });
      }
      if (message.includes("timeout") || message.includes("timed out")) {
        return new PaymentTimeoutError("Payment timed out", {
          cause: response.error,
        });
      }
      return new RouteNotFoundError(
        response.error?.message ?? "Payment failed",
        { cause: response.error },
      );

    case "UNAUTHORIZED":
    case "RESTRICTED":
      return new AuthenticationError(
        response.error?.message ?? "Unauthorized",
        { cause: response.error },
      );

    case "RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return new ConnectionError(
        response.error?.message ?? "Rate limited",
        { cause: response.error },
      );

    default:
      return new ConnectionError(
        response.error?.message ?? `NWC error: ${code}`,
        { cause: response.error },
      );
  }
}

export function mapTransportError(error: unknown): LightningError {
  const message =
    error instanceof Error ? error.message.toLowerCase() : "unknown";

  if (message.includes("timeout") || message.includes("timed out")) {
    return new PaymentTimeoutError("NWC request timed out", { cause: error });
  }

  return new ConnectionError(
    `NWC transport error: ${error instanceof Error ? error.message : "unknown"}`,
    { cause: error },
  );
}
