import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { LightningProvider } from "../provider.js";
import { createMemoryStore } from "../store.js";
import { lightningSessionServer } from "./session.js";

// Mock light-bolt11-decoder so tests can use fake BOLT11 strings.
// In real BOLT11, the HRP is "lnbc" + optional amount + "1" separator.
// "lnbc1return" has no amount (separator "1" immediately after "lnbc").
// "lnbc200n1deposit" has amount "200n" between "lnbc" and the "1" separator.
vi.mock("light-bolt11-decoder", () => ({
  decode: (bolt11: string) => {
    // Match amount between "lnbc"/"lnbcrt" prefix and the "1" separator.
    const match = bolt11.match(/^lnbc(?:rt)?(\d+[munp]?)1/);
    const hasAmount = match !== null && match[1] !== "";
    return {
      sections: hasAmount
        ? [{ name: "amount", letters: match![1], value: "1000" }]
        : [],
    };
  },
}));

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
            depositInvoice: "lnbc100n1deposit",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "100",
        depositInvoice: "lnbc100n1deposit",
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

  it("throws when deducting from nonexistent session", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    await expect(method.deduct("nonexistent", 10)).rejects.toThrow(
      "Session not found",
    );
  });

  it("throws when deducting from closed session", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(8);

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

    // Deducting from closed session should throw
    await expect(method.deduct(paymentHash, 10)).rejects.toThrow(
      "already closed",
    );
  });

  it("deducts exact remaining balance then rejects", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(9);

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
            depositAmount: "100",
            depositInvoice: "lnbc100n1deposit",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "100",
        depositInvoice: "lnbc100n1deposit",
      },
    });

    // Deduct all 100
    expect(await method.deduct(paymentHash, 100)).toBe(true);
    // Next deduction of even 1 sat should fail
    expect(await method.deduct(paymentHash, 1)).toBe(false);
  });

  it("waitForTopUp resolves false on timeout", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(10);

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
            depositAmount: "100",
            depositInvoice: "lnbc100n1deposit",
          },
        },
      },
      request: {
        amount: "10",
        currency: "sat",
        paymentHash,
        depositAmount: "100",
        depositInvoice: "lnbc100n1deposit",
      },
    });

    // waitForTopUp with a very short timeout should resolve false
    const result = await method.waitForTopUp(paymentHash, 50);
    expect(result).toBe(false);
  });

  it("passes amountSats to provider for refund payment", async () => {
    const store = createMemoryStore();
    let capturedAmountSats: number | undefined;
    const provider = makeProvider();
    const originalPayInvoice = provider.payInvoice.bind(provider);
    provider.payInvoice = async (params) => {
      capturedAmountSats = params.amountSats;
      return originalPayInvoice(params);
    };
    const { preimage, paymentHash } = makePreimage(11);

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

    // Deduct 50 sats
    await method.deduct(paymentHash, 50);

    // Close session — should refund 150 sats
    await (method as any).verify({
      credential: {
        payload: { action: "close", sessionId: paymentHash, preimage },
        challenge: {
          request: { amount: "10", currency: "sat", paymentHash },
        },
      },
      request: { amount: "10", currency: "sat", paymentHash },
    });

    expect(capturedAmountSats).toBe(150);
  });

  it("rejects return invoice that encodes a non-zero amount", async () => {
    const store = createMemoryStore();
    const provider = makeProvider();
    const { preimage, paymentHash } = makePreimage(12);

    const method = lightningSessionServer({
      provider,
      store,
      idleTimeout: 0,
    });

    await expect(
      (method as any).verify({
        credential: {
          payload: {
            action: "open",
            preimage,
            // This invoice has an amount encoded (200n)
            returnInvoice: "lnbc200n1return",
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
      }),
    ).rejects.toThrow("Return invoice must not encode an amount");
  });
});
