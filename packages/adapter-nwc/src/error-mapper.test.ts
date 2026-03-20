import { describe, expect, it } from "vitest";
import { mapNwcError, mapTransportError } from "./error-mapper.js";
import type { NwcResponse } from "./types.js";

function makeErrorResponse(code: string, message = ""): NwcResponse {
  return {
    result_type: "pay_invoice",
    error: { code, message },
  };
}

describe("mapNwcError", () => {
  it("maps INSUFFICIENT_BALANCE to InsufficientBalanceError", () => {
    const err = mapNwcError(makeErrorResponse("INSUFFICIENT_BALANCE"));
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("maps PAYMENT_FAILED to RouteNotFoundError by default", () => {
    const err = mapNwcError(makeErrorResponse("PAYMENT_FAILED", "no route"));
    expect(err.code).toBe("ROUTE_NOT_FOUND");
  });

  it("maps PAYMENT_FAILED with expired message to InvoiceExpiredError", () => {
    const err = mapNwcError(
      makeErrorResponse("PAYMENT_FAILED", "invoice expired"),
    );
    expect(err.code).toBe("INVOICE_EXPIRED");
  });

  it("maps PAYMENT_FAILED with timeout message to PaymentTimeoutError", () => {
    const err = mapNwcError(
      makeErrorResponse("PAYMENT_FAILED", "payment timed out"),
    );
    expect(err.code).toBe("PAYMENT_TIMEOUT");
  });

  it("maps UNAUTHORIZED to AuthenticationError", () => {
    const err = mapNwcError(makeErrorResponse("UNAUTHORIZED"));
    expect(err.code).toBe("AUTHENTICATION_ERROR");
  });

  it("maps RESTRICTED to AuthenticationError", () => {
    const err = mapNwcError(makeErrorResponse("RESTRICTED"));
    expect(err.code).toBe("AUTHENTICATION_ERROR");
  });

  it("maps RATE_LIMITED to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("RATE_LIMITED"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps QUOTA_EXCEEDED to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("QUOTA_EXCEEDED"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps NOT_IMPLEMENTED to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("NOT_IMPLEMENTED"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps INTERNAL to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("INTERNAL"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps OTHER to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("OTHER"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps NOT_FOUND to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("NOT_FOUND"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("maps unknown codes to ConnectionError", () => {
    const err = mapNwcError(makeErrorResponse("SOMETHING_ELSE"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });
});

describe("mapTransportError", () => {
  it("maps timeout errors to PaymentTimeoutError", () => {
    const err = mapTransportError(new Error("request timed out"));
    expect(err.code).toBe("PAYMENT_TIMEOUT");
  });

  it("maps other errors to ConnectionError", () => {
    const err = mapTransportError(new Error("relay disconnected"));
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  it("handles non-Error values", () => {
    const err = mapTransportError("string error");
    expect(err.code).toBe("CONNECTION_ERROR");
  });
});
