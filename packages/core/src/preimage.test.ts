import { describe, expect, it } from "vitest";
import {
  base64ToHex,
  bytesToHex,
  hexToBase64Url,
  hexToBytes,
  verifyPreimage,
} from "./preimage.js";

describe("hexToBytes", () => {
  it("converts hex string to Buffer", () => {
    const bytes = hexToBytes("deadbeef");
    expect(bytes).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  });

  it("handles empty string", () => {
    expect(hexToBytes("")).toEqual(Buffer.alloc(0));
  });
});

describe("bytesToHex", () => {
  it("converts Buffer to hex string", () => {
    const hex = bytesToHex(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(hex).toBe("deadbeef");
  });

  it("pads single digit bytes", () => {
    const hex = bytesToHex(Buffer.from([0x0a, 0x00, 0xff]));
    expect(hex).toBe("0a00ff");
  });
});

describe("base64ToHex", () => {
  it("converts base64 to hex", () => {
    expect(base64ToHex("3q2+7w==")).toBe("deadbeef");
  });
});

describe("hexToBase64Url", () => {
  it("converts hex to base64url", () => {
    expect(hexToBase64Url("deadbeef")).toBe("3q2-7w");
  });
});

describe("verifyPreimage", () => {
  it("returns true for valid preimage", () => {
    const preimage =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const hash =
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
    expect(verifyPreimage(preimage, hash)).toBe(true);
  });

  it("returns false for invalid preimage", () => {
    const preimage =
      "0000000000000000000000000000000000000000000000000000000000000001";
    const hash =
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
    expect(verifyPreimage(preimage, hash)).toBe(false);
  });

  it("is case-insensitive for payment hash", () => {
    const preimage =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const hash =
      "66687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925";
    expect(verifyPreimage(preimage, hash)).toBe(true);
  });
});
