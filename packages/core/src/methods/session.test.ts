import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LightningProvider } from "../provider.js";
import { createMemoryStore } from "../store.js";
import { lightningSessionServer } from "./session.js";

function makePreimage(seed: number) {
  const preimage = Buffer.alloc(32);
  preimage.writeUInt32BE(seed, 0);
  const paymentHash = createHash("sha256").update(preimage).digest("hex");
  return { preimage: preimage.toString("hex"), paymentHash };
}

function makeProvider(): LightningProvider & { payments: string[] } {
  let counter = 100;
  const payments: string[] = [];
  return {
    payments,
    async createInvoice({ amountSats }) {
      counter++;
      const buf = Buffer.alloc(32);
      buf.writeUInt32BE(counter, 0);
      const paymentHash = createHash("sha256").update(buf).digest("hex");
      return {
        bolt11: `lnbc${amountSats}n1deposit${paymentHash.slice(0, 8)}`,
        paymentHash,
      };
    },
    async payInvoice({ bolt11 }) {
      payments.push(bolt11);
      return { preimage: "refund" + "00".repeat(29) };
    },
    async lookupInvoice() {
      return { settled: false };
    },
  };
}

describe("lightningSessionServer", () => {
  it("opens a session with valid deposit preimage", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(1);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    const receipt = await (method as any).verify({
      credential: {
        payload: {
          action: "open",
          preimage,
          returnInvoice: "lnbc1return",
        },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
            depositInvoice: "lnbc200n1deposit",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
        depositInvoice: "lnbc200n1deposit",
      },
    });

    expect(receipt.reference).toBe(paymentHash);
    expect(receipt.status).toBe("success");
  });

  it("rejects replay of open credential", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(2);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    const credArg = {
      credential: {
        payload: {
          action: "open" as const,
          preimage,
          returnInvoice: "lnbc1return",
        },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
            depositInvoice: "lnbc200n1deposit",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
        depositInvoice: "lnbc200n1deposit",
      },
    };

    await (method as any).verify(credArg);
    await expect((method as any).verify(credArg)).rejects.toThrow(
      "already consumed",
    );
  });

  it("authenticates bearer requests with valid preimage", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(3);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    // Open session first
    await (method as any).verify({
      credential: {
        payload: { action: "open", preimage, returnInvoice: "lnbc1return" },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
      },
    });

    // Bearer request
    const receipt = await (method as any).verify({
      credential: {
        payload: { action: "bearer", sessionId: paymentHash, preimage },
        challenge: {
          request: { amount: "10", currency: "sat", paymentHash },
        },
      },
      request: { amount: "10", currency: "sat", paymentHash },
    });

    expect(receipt.reference).toBe(paymentHash);
  });

  it("rejects bearer with wrong preimage", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(4);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    await (method as any).verify({
      credential: {
        payload: { action: "open", preimage, returnInvoice: "lnbc1return" },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
      },
    });

    await expect(
      (method as any).verify({
        credential: {
          payload: {
            action: "bearer",
            sessionId: paymentHash,
            preimage: "ff".repeat(32),
          },
          challenge: {
            request: { amount: "10", currency: "sat", paymentHash },
          },
        },
        request: { amount: "10", currency: "sat", paymentHash },
      }),
    ).rejects.toThrow("preimage does not match");
  });

  it("deducts from session balance", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(5);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    // Open session with 200 sat deposit
    await (method as any).verify({
      credential: {
        payload: { action: "open", preimage, returnInvoice: "lnbc1return" },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
      },
    });

    // Deduct 50 sats
    expect(await method.deduct(paymentHash, 50)).toBe(true);
    // Deduct another 100
    expect(await method.deduct(paymentHash, 100)).toBe(true);
    // Try to deduct 100 more (only 50 left) — should fail
    expect(await method.deduct(paymentHash, 100)).toBe(false);
    // Deduct remaining 50
    expect(await method.deduct(paymentHash, 50)).toBe(true);
  });

  it("closes session and triggers refund", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(6);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    // Open session
    await (method as any).verify({
      credential: {
        payload: { action: "open", preimage, returnInvoice: "lnbc1return" },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "200",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "200",
      },
    });

    // Deduct some
    await method.deduct(paymentHash, 50);

    // Close session
    await (method as any).verify({
      credential: {
        payload: { action: "close", sessionId: paymentHash, preimage },
        challenge: {
          request: { amount: "10", currency: "sat", paymentHash },
        },
      },
      request: { amount: "10", currency: "sat", paymentHash },
    });

    // Provider should have been called with the return invoice for refund
    expect(provider.payments).toContain("lnbc1return");

    // Bearer should fail after close
    await expect(
      (method as any).verify({
        credential: {
          payload: { action: "bearer", sessionId: paymentHash, preimage },
          challenge: {
            request: { amount: "10", currency: "sat", paymentHash },
          },
        },
        request: { amount: "10", currency: "sat", paymentHash },
      }),
    ).rejects.toThrow("already closed");
  });

  it("handles top-up", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(7);
    const { preimage: topUpPreimage, paymentHash: topUpHash } =
      makePreimage(70);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    // Open session with 100 sat deposit
    await (method as any).verify({
      credential: {
        payload: { action: "open", preimage, returnInvoice: "lnbc1return" },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash,
            depositAmount: "100",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "100",
      },
    });

    // Deduct all 100
    expect(await method.deduct(paymentHash, 100)).toBe(true);
    expect(await method.deduct(paymentHash, 10)).toBe(false);

    // Top up with 50 more sats
    await (method as any).verify({
      credential: {
        payload: {
          action: "topUp",
          sessionId: paymentHash,
          topUpPreimage,
        },
        challenge: {
          request: {
            amount: "10",
            currency: "sat",
            paymentHash: topUpHash,
            depositAmount: "50",
            depositInvoice: "lnbc50n1topup",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash: topUpHash,
        depositAmount: "50",
        depositInvoice: "lnbc50n1topup",
      },
    });

    // Should now be able to deduct again
    expect(await method.deduct(paymentHash, 50)).toBe(true);
  });
});
