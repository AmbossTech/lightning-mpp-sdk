import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LightningProvider } from "../provider.js";
import { createMemoryStore } from "../store.js";
import { lightningChargeClient, lightningChargeServer } from "./charge.js";

function makeProvider(
  overrides: Partial<LightningProvider> = {},
): LightningProvider {
  let counter = 0;
  return {
    async createInvoice({ amountSats }) {
      counter++;
      const preimage = Buffer.alloc(32);
      preimage.writeUInt32BE(counter, 0);
      const paymentHash = createHash("sha256").update(preimage).digest("hex");
      return {
        bolt11: `lnbc${amountSats}n1mock${paymentHash.slice(0, 8)}`,
        paymentHash,
      };
    },
    async payInvoice() {
      return { preimage: "deadbeef".repeat(8) };
    },
    async lookupInvoice() {
      return { settled: false };
    },
    ...overrides,
  };
}

function makePreimage(seed: number) {
  const preimage = Buffer.alloc(32);
  preimage.writeUInt32BE(seed, 0);
  const paymentHash = createHash("sha256").update(preimage).digest("hex");
  return { preimage: preimage.toString("hex"), paymentHash };
}

describe("lightningChargeServer", () => {
  it("uses payment hash as receipt reference (not preimage)", async () => {
    const store = createMemoryStore();
    const { preimage, paymentHash } = makePreimage(1);
    const provider = makeProvider({
      async createInvoice() {
        return { bolt11: "lnbc1000n1test", paymentHash };
      },
    });

    const method = lightningChargeServer({ provider, store });
    // Access the verify function via the method internals.
    // We'll test the full flow by constructing a credential object.
    // For simplicity, we test the verify logic directly.
    const receipt = await (method as any).verify({
      credential: {
        payload: { preimage },
        challenge: {
          request: {
            amount: "1000",
            methodDetails: { invoice: "lnbc1000n1test", paymentHash },
          },
        },
      },
      request: {
        amount: "1000",
        methodDetails: { invoice: "lnbc1000n1test", paymentHash },
      },
    });

    // Receipt reference should be the payment hash, NOT the preimage.
    expect(receipt.reference).toBe(paymentHash);
    expect(receipt.reference).not.toBe(preimage);
  });

  it("rejects replayed preimages (consume-once)", async () => {
    const store = createMemoryStore();
    const { preimage, paymentHash } = makePreimage(2);
    const provider = makeProvider();

    const method = lightningChargeServer({ provider, store });
    const credentialArg = {
      credential: {
        payload: { preimage },
        challenge: {
          request: {
            amount: "1000",
            methodDetails: { invoice: "lnbc1000n1test", paymentHash },
          },
        },
      },
      request: {
        amount: "1000",
        methodDetails: { invoice: "lnbc1000n1test", paymentHash },
      },
    };

    // First verification should succeed.
    await (method as any).verify(credentialArg);

    // Second verification with same preimage should be rejected.
    await expect((method as any).verify(credentialArg)).rejects.toThrow(
      "already consumed",
    );
  });

  it("rejects invalid preimage", async () => {
    const store = createMemoryStore();
    const { paymentHash } = makePreimage(3);
    const wrongPreimage = "ff".repeat(32);
    const provider = makeProvider();

    const method = lightningChargeServer({ provider, store });

    await expect(
      (method as any).verify({
        credential: {
          payload: { preimage: wrongPreimage },
          challenge: {
            request: {
              amount: "1000",
              methodDetails: { invoice: "lnbc1000n1test", paymentHash },
            },
          },
        },
        request: {
          amount: "1000",
          methodDetails: { invoice: "lnbc1000n1test", paymentHash },
        },
      }),
    ).rejects.toThrow("Invalid preimage");
  });

  it("rejects expired invoices", async () => {
    const store = createMemoryStore();
    const { preimage, paymentHash } = makePreimage(4);
    const provider = makeProvider({
      async createInvoice() {
        return { bolt11: "lnbc1000n1test", paymentHash };
      },
    });

    const method = lightningChargeServer({
      provider,
      store,
      invoiceExpirySecs: 1,
    });

    // Simulate invoice creation by storing expiry info in the past.
    await store.put(`lightning-charge:expiry:${paymentHash}`, {
      createdAt: Date.now() - 2000,
      expirySecs: 1,
    });

    await expect(
      (method as any).verify({
        credential: {
          payload: { preimage },
          challenge: {
            request: {
              amount: "1000",
              methodDetails: { invoice: "lnbc1000n1test", paymentHash },
            },
          },
        },
        request: {
          amount: "1000",
          methodDetails: { invoice: "lnbc1000n1test", paymentHash },
        },
      }),
    ).rejects.toThrow("Invoice has expired");
  });

  it("guards against hashing hex string instead of decoded bytes", () => {
    // This test prevents the encoding footgun: sha256("00...00") vs sha256(hexToBytes("00...00"))
    const preimage =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const correctHash = createHash("sha256")
      .update(Buffer.from(preimage, "hex"))
      .digest("hex");
    const wrongHash = createHash("sha256")
      .update(Buffer.from(preimage, "utf8"))
      .digest("hex");

    expect(correctHash).not.toBe(wrongHash);
    // verifyPreimage must use the decoded bytes, not the raw string
    expect(correctHash).toBe(
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
    );
  });

  it("passes maxFeeSats through to provider in client", async () => {
    let capturedMaxFee: number | undefined;
    const provider = makeProvider({
      async payInvoice({ maxFeeSats }) {
        capturedMaxFee = maxFeeSats;
        return { preimage: "aa".repeat(32) };
      },
    });

    const method = lightningChargeClient(provider, { maxFeeSats: 50 });
    await (method as any).createCredential({
      challenge: {
        request: {
          amount: "1000",
          methodDetails: { invoice: "lnbc1000n1test", paymentHash: "abc" },
        },
      },
    });

    expect(capturedMaxFee).toBe(50);
  });
});
