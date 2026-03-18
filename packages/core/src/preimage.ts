import { createHash } from "node:crypto";

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
