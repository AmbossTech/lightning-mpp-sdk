import { Credential, Method, Receipt, z } from "mppx";
import type { LightningProvider } from "../provider.js";
import { verifyPreimage } from "../preimage.js";

export const lightningCharge = Method.from({
  name: "lightning" as const,
  intent: "charge" as const,
  schema: {
    credential: {
      payload: z.object({
        preimage: z.string(),
      }),
    },
    request: z.object({
      invoice: z.string(),
      paymentHash: z.string(),
      amount: z.string(),
      currency: z.string(),
      recipient: z.string(),
    }),
  },
});

export function lightningChargeClient(provider: LightningProvider) {
  return Method.toClient(lightningCharge, {
    async createCredential({ challenge }) {
      const result = await provider.payInvoice({
        bolt11: challenge.request.invoice,
      });
      return Credential.serialize({
        challenge,
        payload: { preimage: result.preimage },
      });
    },
  });
}

export function lightningChargeServer() {
  return Method.toServer(lightningCharge, {
    async verify({ credential }) {
      const preimage = credential.payload.preimage;
      const expectedHash = credential.challenge.request.paymentHash;
      const isValid = verifyPreimage(preimage, expectedHash);
      if (!isValid) {
        throw new Error("Invalid preimage: does not match payment hash");
      }
      return Receipt.from({
        method: "lightning",
        reference: preimage,
        status: "success",
        timestamp: new Date().toISOString(),
      });
    },
  });
}
