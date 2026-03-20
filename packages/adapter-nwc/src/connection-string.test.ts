import { describe, expect, it } from "vitest";
import { parseConnectionString } from "./connection-string.js";

const VALID_PUBKEY = "a".repeat(64);
const VALID_SECRET = "b".repeat(64);
const VALID_RELAY = "wss://relay.example.com";

function makeUri(
  pubkey = VALID_PUBKEY,
  relay = VALID_RELAY,
  secret = VALID_SECRET,
  extra = "",
) {
  return `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(relay)}&secret=${secret}${extra}`;
}

describe("parseConnectionString", () => {
  it("parses a valid connection string", () => {
    const info = parseConnectionString(makeUri());
    expect(info.walletPubkey).toBe(VALID_PUBKEY);
    expect(info.relayUrl).toBe(VALID_RELAY);
    expect(info.secret).toBe(VALID_SECRET);
    expect(info.lud16).toBeUndefined();
  });

  it("parses lud16 parameter", () => {
    const info = parseConnectionString(makeUri(undefined, undefined, undefined, "&lud16=user@example.com"));
    expect(info.lud16).toBe("user@example.com");
  });

  it("throws on invalid scheme", () => {
    expect(() => parseConnectionString("http://foo")).toThrow(
      "must start with nostr+walletconnect://",
    );
  });

  it("throws on missing query parameters", () => {
    expect(() =>
      parseConnectionString(`nostr+walletconnect://${VALID_PUBKEY}`),
    ).toThrow("missing query parameters");
  });

  it("throws on invalid pubkey", () => {
    expect(() => parseConnectionString(makeUri("not-hex"))).toThrow(
      "wallet pubkey must be 64-char hex",
    );
  });

  it("throws on short pubkey", () => {
    expect(() => parseConnectionString(makeUri("aa"))).toThrow(
      "wallet pubkey must be 64-char hex",
    );
  });

  it("throws on missing relay", () => {
    expect(() =>
      parseConnectionString(
        `nostr+walletconnect://${VALID_PUBKEY}?secret=${VALID_SECRET}`,
      ),
    ).toThrow("relay must be a wss:// URL");
  });

  it("throws on non-wss relay", () => {
    expect(() => parseConnectionString(makeUri(undefined, "ws://relay.example.com"))).toThrow(
      "relay must be a wss:// URL",
    );
  });

  it("throws on missing secret", () => {
    expect(() =>
      parseConnectionString(
        `nostr+walletconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`,
      ),
    ).toThrow("secret must be 64-char hex");
  });

  it("throws on invalid secret", () => {
    expect(() => parseConnectionString(makeUri(undefined, undefined, "zz"))).toThrow(
      "secret must be 64-char hex",
    );
  });
});
