import { Credential, Method, Receipt, z } from "mppx";
import type { LightningProvider } from "../provider.js";
import { verifyPreimage } from "../preimage.js";
import { createMemoryStore, type KeyValueStore } from "../store.js";

/**
 * Shared charge method definition — wire-format compatible with Spark SDK.
 * Method name: "lightning", intent: "charge".
 */
export const lightningCharge = Method.from({
  intent: "charge" as const,
  name: "lightning" as const,
  schema: {
    credential: {
      payload: z.object({
        preimage: z.string(),
      }),
    },
    request: z.object({
      amount: z.string(),
      currency: z.optional(z.string()),
      description: z.optional(z.string()),
      methodDetails: z.object({
        invoice: z.string(),
        paymentHash: z.optional(z.string()),
        network: z.optional(z.string()),
      }),
    }),
  },
});

/**
 * Creates a client-side charge method.
 * Pays the BOLT11 invoice from the 402 challenge and returns the preimage.
 */
export function lightningChargeClient(
  provider: LightningProvider,
  options?: {
    maxFeeSats?: number;
    onProgress?: (event: LightningChargeClientProgress) => void;
  },
) {
  const { maxFeeSats, onProgress } = options ?? {};

  return Method.toClient(lightningCharge, {
    async createCredential({ challenge }) {
      const { amount, methodDetails } = challenge.request;
      const invoice = methodDetails.invoice;

      onProgress?.({
        type: "challenge",
        invoice,
        amountSats: parseInt(amount, 10),
      });
      onProgress?.({ type: "paying" });

      const result = await provider.payInvoice({
        bolt11: invoice,
        maxFeeSats,
      });

      onProgress?.({ type: "paid", preimage: result.preimage });

      return Credential.serialize({
        challenge,
        payload: { preimage: result.preimage },
      });
    },
  });
}

export type LightningChargeClientProgress =
  | { type: "challenge"; invoice: string; amountSats: number }
  | { type: "paying" }
  | { type: "paid"; preimage: string };

/**
 * Creates a server-side charge method.
 *
 * - Generates a fresh BOLT11 invoice for each 402 challenge via the provider.
 * - Verifies preimage with sha256(preimage) == paymentHash.
 * - Tracks consumed preimages to prevent replay attacks.
 * - Uses payment hash (not preimage) as receipt reference for security.
 */
export function lightningChargeServer(options: {
  provider: LightningProvider;
  store?: KeyValueStore;
  currency?: string;
  network?: string;
  /** Invoice expiry in seconds. Defaults to 3600 (1 hour). */
  invoiceExpirySecs?: number;
}) {
  const {
    provider,
    store = createMemoryStore(),
    currency = "sat",
    network,
    invoiceExpirySecs = 3600,
  } = options;

  return Method.toServer(lightningCharge, {
    defaults: {
      currency,
      methodDetails: {
        invoice: "",
        paymentHash: "",
      },
    },

    async request({ credential, request }) {
      // Client is retrying with credential — preserve original challenge.
      if (credential) {
        return credential.challenge.request as typeof request;
      }

      // Generate a fresh invoice for the 402 challenge.
      const amountSats = parseInt(request.amount, 10);
      const { bolt11, paymentHash } = await provider.createInvoice({
        amountSats,
        memo: request.description ?? "",
        expirySecs: invoiceExpirySecs,
      });

      // Track invoice creation time for expiry validation during verify.
      const expiryKey = `lightning-charge:expiry:${paymentHash}`;
      await store.put(expiryKey, {
        createdAt: Date.now(),
        expirySecs: invoiceExpirySecs,
      });

      return {
        ...request,
        methodDetails: {
          invoice: bolt11,
          paymentHash,
          ...(network !== undefined && { network }),
        },
      };
    },

    async verify({ credential }) {
      const preimage = credential.payload.preimage;
      const expectedHash =
        credential.challenge.request.methodDetails.paymentHash;

      if (!expectedHash) {
        throw new Error("Missing paymentHash in challenge");
      }

      // Check invoice expiry before verifying the preimage to prevent
      // accepting preimages for invoices the Lightning node would not settle.
      const expiryKey = `lightning-charge:expiry:${expectedHash}`;
      const expiryInfo = await store.get<{
        createdAt: number;
        expirySecs: number;
      }>(expiryKey);
      if (expiryInfo) {
        const expiresAt = expiryInfo.createdAt + expiryInfo.expirySecs * 1000;
        if (Date.now() > expiresAt) {
          throw new Error("Invoice has expired");
        }
      }

      const isValid = verifyPreimage(preimage, expectedHash);
      if (!isValid) {
        throw new Error(
          `Invalid preimage: sha256(${preimage}) != ${expectedHash}`,
        );
      }

      // Consume-once: reject replayed preimages.
      const consumedKey = `lightning-charge:consumed:${expectedHash}`;
      if (await store.get(consumedKey)) {
        throw new Error(
          `Preimage already consumed for payment: ${expectedHash}`,
        );
      }
      await store.put(consumedKey, true);

      // Use payment hash as receipt reference — preimage is a bearer secret
      // and MUST NOT appear in receipts/logs.
      return Receipt.from({
        method: "lightning",
        reference: expectedHash,
        status: "success",
        timestamp: new Date().toISOString(),
      });
    },
  });
}
