import { ConnectionError } from "@ambosstech/lightning-mpp-sdk";
import type { NwcConnectionInfo } from "./types.js";

const HEX_64_RE = /^[0-9a-f]{64}$/;

export function parseConnectionString(uri: string): NwcConnectionInfo {
  if (!uri.startsWith("nostr+walletconnect://")) {
    throw new ConnectionError(
      "Invalid NWC connection string: must start with nostr+walletconnect://",
    );
  }

  const withoutScheme = uri.slice("nostr+walletconnect://".length);
  const questionIdx = withoutScheme.indexOf("?");

  if (questionIdx === -1) {
    throw new ConnectionError(
      "Invalid NWC connection string: missing query parameters",
    );
  }

  const walletPubkey = withoutScheme.slice(0, questionIdx);

  if (!HEX_64_RE.test(walletPubkey)) {
    throw new ConnectionError(
      "Invalid NWC connection string: wallet pubkey must be 64-char hex",
    );
  }

  const params = new URLSearchParams(withoutScheme.slice(questionIdx + 1));

  const relayUrl = params.get("relay");
  if (!relayUrl || !relayUrl.startsWith("wss://")) {
    throw new ConnectionError(
      "Invalid NWC connection string: relay must be a wss:// URL",
    );
  }

  const secret = params.get("secret");
  if (!secret || !HEX_64_RE.test(secret)) {
    throw new ConnectionError(
      "Invalid NWC connection string: secret must be 64-char hex",
    );
  }

  const lud16 = params.get("lud16") || undefined;

  return { walletPubkey, relayUrl, secret, lud16 };
}
