import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NwcConnectionInfo } from "./types.js";

const VALID_INFO: NwcConnectionInfo = {
  walletPubkey: "a".repeat(64),
  relayUrl: "wss://relay.example.com",
  secret: "b".repeat(64),
};

// Mock nostr-tools modules
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockSubscribe = vi.fn();
const mockRelayClose = vi.fn();
const mockRelayConnect = vi.fn().mockResolvedValue({
  connected: true,
  publish: mockPublish,
  subscribe: mockSubscribe,
  close: mockRelayClose,
});

vi.mock("nostr-tools/relay", () => ({
  Relay: { connect: (...args: unknown[]) => mockRelayConnect(...args) },
}));

vi.mock("nostr-tools/pure", () => ({
  finalizeEvent: vi.fn((template: Record<string, unknown>) => ({
    ...template,
    id: "event-id-123",
    sig: "sig-abc",
    pubkey: "c".repeat(64),
  })),
  getPublicKey: vi.fn(() => "c".repeat(64)),
}));

vi.mock("nostr-tools/nip44", () => ({
  v2: {
    utils: {
      getConversationKey: vi.fn(() => new Uint8Array(32)),
    },
    encrypt: vi.fn(() => "encrypted-content"),
    decrypt: vi.fn(),
  },
}));


describe("createNwcTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelayConnect.mockResolvedValue({
      connected: true,
      publish: mockPublish,
      subscribe: mockSubscribe,
      close: mockRelayClose,
    });
  });

  // Dynamic import so mocks are in place
  async function getTransport(opts = {}) {
    const { createNwcTransport } = await import("./nwc-client.js");
    return createNwcTransport(VALID_INFO, opts);
  }

  it("connects to relay on first request", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "make_invoice",
        result: { invoice: "lnbc1...", payment_hash: "abc123" },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    await transport.makeInvoice({ amount: 1000 });
    expect(mockRelayConnect).toHaveBeenCalledWith("wss://relay.example.com");
  });

  it("makeInvoice returns invoice and payment_hash", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "make_invoice",
        result: { invoice: "lnbc1...", payment_hash: "hash123" },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    const result = await transport.makeInvoice({ amount: 5000 });
    expect(result.invoice).toBe("lnbc1...");
    expect(result.payment_hash).toBe("hash123");
  });

  it("payInvoice returns preimage", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "pay_invoice",
        result: { preimage: "pre123" },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    const result = await transport.payInvoice({ invoice: "lnbc1..." });
    expect(result.preimage).toBe("pre123");
  });

  it("lookupInvoice returns settled info", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "lookup_invoice",
        result: { settled_at: 1700000000, preimage: "pre456", amount: 5000000 },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    const result = await transport.lookupInvoice({ payment_hash: "hash456" });
    expect(result.settled_at).toBe(1700000000);
    expect(result.preimage).toBe("pre456");
    expect(result.amount).toBe(5000000);
  });

  it("throws mapped error on NWC error response", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "pay_invoice",
        error: { code: "INSUFFICIENT_BALANCE", message: "not enough funds" },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    await expect(transport.payInvoice({ invoice: "lnbc1..." })).rejects.toThrow(
      "Insufficient balance",
    );
  });

  it("close disconnects from relay", async () => {
    const nip44 = await import("nostr-tools/nip44");
    vi.mocked(nip44.v2.decrypt).mockReturnValue(
      JSON.stringify({
        result_type: "make_invoice",
        result: { invoice: "lnbc1...", payment_hash: "h" },
      }),
    );

    mockSubscribe.mockImplementation((_filters: unknown, opts: { onevent: (evt: Record<string, unknown>) => void }) => {
      const sub = { close: vi.fn() };
      setTimeout(() => {
        opts.onevent({ content: "encrypted-response", id: "resp-1" });
      }, 0);
      return sub;
    });

    const transport = await getTransport();
    await transport.makeInvoice({ amount: 1000 });
    transport.close();
    expect(mockRelayClose).toHaveBeenCalled();
  });

  it("throws ConnectionError when relay connect fails", async () => {
    mockRelayConnect.mockRejectedValueOnce(new Error("connection refused"));

    const transport = await getTransport();
    await expect(
      transport.makeInvoice({ amount: 1000 }),
    ).rejects.toThrow("NWC transport error");
  });
});
