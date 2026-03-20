import { Relay } from "nostr-tools/relay";
import { finalizeEvent } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import { mapNwcError, mapTransportError } from "./error-mapper.js";
import type {
  NwcConnectionInfo,
  NwcRequest,
  NwcResponse,
  NwcTransport,
} from "./types.js";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const NWC_REQUEST_KIND = 23194;
const NWC_RESPONSE_KIND = 23195;
const DEFAULT_TIMEOUT_SECS = 60;

interface NwcTransportOptions {
  timeoutSecs?: number;
}

export function createNwcTransport(
  info: NwcConnectionInfo,
  opts: NwcTransportOptions = {},
): NwcTransport {
  const { walletPubkey, relayUrl, secret } = info;
  const timeoutMs = (opts.timeoutSecs ?? DEFAULT_TIMEOUT_SECS) * 1000;
  const secretBytes = hexToBytes(secret);
  const conversationKey = nip44.v2.utils.getConversationKey(
    secretBytes,
    walletPubkey,
  );

  let relay: Relay | null = null;

  async function ensureConnected(): Promise<Relay> {
    if (relay && relay.connected) return relay;
    try {
      relay = await Relay.connect(relayUrl);
      return relay;
    } catch (error) {
      throw mapTransportError(error);
    }
  }

  function encrypt(content: string): string {
    return nip44.v2.encrypt(content, conversationKey);
  }

  function decrypt(content: string): string {
    return nip44.v2.decrypt(content, conversationKey);
  }

  async function sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<NwcResponse> {
    const r = await ensureConnected();

    const request: NwcRequest = { method, params };
    const encrypted = encrypt(JSON.stringify(request));

    const event = finalizeEvent(
      {
        kind: NWC_REQUEST_KIND,
        content: encrypted,
        tags: [["p", walletPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      },
      secretBytes,
    );

    return new Promise<NwcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close();
        reject(mapTransportError(new Error("NWC request timed out")));
      }, timeoutMs);

      const sub = r.subscribe(
        [
          {
            kinds: [NWC_RESPONSE_KIND],
            authors: [walletPubkey],
            "#e": [event.id],
          },
        ],
        {
          onevent(evt) {
            clearTimeout(timer);
            sub.close();
            try {
              const decrypted = decrypt(evt.content);
              const response = JSON.parse(decrypted) as NwcResponse;

              if (response.error) {
                reject(mapNwcError(response));
              } else {
                resolve(response);
              }
            } catch (err) {
              reject(mapTransportError(err));
            }
          },
          oneose() {
            // Keep subscription open waiting for the response event
          },
        },
      );

      // Publish the request after subscribing
      r.publish(event).catch((err: unknown) => {
        clearTimeout(timer);
        sub.close();
        reject(mapTransportError(err));
      });
    });
  }

  return {
    async makeInvoice(params) {
      const response = await sendRequest("make_invoice", {
        amount: params.amount,
        description: params.description,
        expiry: params.expiry,
      });
      const result = response.result as {
        invoice: string;
        payment_hash: string;
      };
      return { invoice: result.invoice, payment_hash: result.payment_hash };
    },

    async payInvoice(params) {
      const reqParams: Record<string, unknown> = { invoice: params.invoice };
      if (params.amount !== undefined) {
        reqParams.amount = params.amount;
      }
      const response = await sendRequest("pay_invoice", reqParams);
      const result = response.result as { preimage: string };
      return { preimage: result.preimage };
    },

    async lookupInvoice(params) {
      const response = await sendRequest("lookup_invoice", {
        payment_hash: params.payment_hash,
      });
      const result = response.result as {
        settled_at?: number;
        preimage?: string;
        amount?: number;
      };
      return {
        settled_at: result.settled_at,
        preimage: result.preimage,
        amount: result.amount,
      };
    },

    close() {
      if (relay) {
        relay.close();
        relay = null;
      }
    },
  };
}
