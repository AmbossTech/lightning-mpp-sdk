import { createHash } from "node:crypto";
import { decode as decodeBolt11 } from "light-bolt11-decoder";

export function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

export function bytesToHex(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function base64ToHex(b64: string): string {
  return Buffer.from(b64, "base64").toString("hex");
}

export function hexToBase64Url(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64url");
}

export function verifyPreimage(preimage: string, paymentHash: string): boolean {
  const computedHash = createHash("sha256")
    .update(Buffer.from(preimage, "hex"))
    .digest("hex");
  return computedHash === paymentHash.toLowerCase();
}

/**
 * Validates that a BOLT11 invoice is a valid 0-amount invoice.
 * Per the session spec, the return invoice must not encode an amount —
 * the server determines the refund amount at close time.
 */
export function validateReturnInvoice(bolt11: string): void {
  let decoded;
  try {
    decoded = decodeBolt11(bolt11);
  } catch (err) {
    throw new Error(
      `Invalid return invoice: ${err instanceof Error ? err.message : "failed to decode BOLT11"}`,
      { cause: err },
    );
  }

  const amountSection = decoded.sections.find((s) => s.name === "amount");
  if (amountSection) {
    throw new Error(
      "Return invoice must not encode an amount — server determines refund at close",
    );
  }
}
