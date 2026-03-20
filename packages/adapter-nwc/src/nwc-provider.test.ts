import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NwcTransport } from "./types.js";

const VALID_PUBKEY = "a".repeat(64);
const VALID_SECRET = "b".repeat(64);
const VALID_CONNECTION_STRING = `nostr+walletconnect://${VALID_PUBKEY}?relay=${encodeURIComponent("wss://relay.example.com")}&secret=${VALID_SECRET}`;

const mockTransport: NwcTransport = {
  makeInvoice: vi.fn(),
  payInvoice: vi.fn(),
  lookupInvoice: vi.fn(),
  close: vi.fn(),
};

vi.mock("./nwc-client.js", () => ({
  createNwcTransport: vi.fn(() => mockTransport),
}));

describe("NwcLightningProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getProvider(config = {}) {
    const { NwcLightningProvider } = await import("./nwc-provider.js");
    return new NwcLightningProvider({
      connectionString: VALID_CONNECTION_STRING,
      ...config,
    });
  }

  it("createInvoice converts sats to msats and returns result", async () => {
    vi.mocked(mockTransport.makeInvoice).mockResolvedValue({
      invoice: "lnbc1...",
      payment_hash: "hash123",
    });

    const provider = await getProvider();
    const result = await provider.createInvoice({
      amountSats: 100,
      memo: "test",
      expirySecs: 3600,
    });

    expect(mockTransport.makeInvoice).toHaveBeenCalledWith({
      amount: 100_000, // 100 sats * 1000
      description: "test",
      expiry: 3600,
    });
    expect(result.bolt11).toBe("lnbc1...");
    expect(result.paymentHash).toBe("hash123");
  });

  it("payInvoice converts amountSats to msats", async () => {
    vi.mocked(mockTransport.payInvoice).mockResolvedValue({
      preimage: "pre123",
    });

    const provider = await getProvider();
    const result = await provider.payInvoice({
      bolt11: "lnbc1...",
      amountSats: 50,
    });

    expect(mockTransport.payInvoice).toHaveBeenCalledWith({
      invoice: "lnbc1...",
      amount: 50_000,
    });
    expect(result.preimage).toBe("pre123");
  });

  it("payInvoice omits amount when amountSats is undefined", async () => {
    vi.mocked(mockTransport.payInvoice).mockResolvedValue({
      preimage: "pre456",
    });

    const provider = await getProvider();
    await provider.payInvoice({ bolt11: "lnbc1..." });

    expect(mockTransport.payInvoice).toHaveBeenCalledWith({
      invoice: "lnbc1...",
      amount: undefined,
    });
  });

  it("payInvoice logs warning when maxFeeSats is provided", async () => {
    vi.mocked(mockTransport.payInvoice).mockResolvedValue({
      preimage: "pre789",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = await getProvider();
    await provider.payInvoice({
      bolt11: "lnbc1...",
      maxFeeSats: 10,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("maxFeeSats"),
    );
    warnSpy.mockRestore();
  });

  it("lookupInvoice maps settled_at to settled boolean", async () => {
    vi.mocked(mockTransport.lookupInvoice).mockResolvedValue({
      settled_at: 1700000000,
      preimage: "pre-abc",
      amount: 5_000_000, // msats
    });

    const provider = await getProvider();
    const result = await provider.lookupInvoice({ paymentHash: "hash456" });

    expect(result.settled).toBe(true);
    expect(result.preimage).toBe("pre-abc");
    expect(result.amountSats).toBe(5000); // 5_000_000 msats / 1000
  });

  it("lookupInvoice returns settled=false when settled_at is undefined", async () => {
    vi.mocked(mockTransport.lookupInvoice).mockResolvedValue({
      settled_at: undefined,
      preimage: undefined,
      amount: 1_000_000,
    });

    const provider = await getProvider();
    const result = await provider.lookupInvoice({ paymentHash: "hash789" });

    expect(result.settled).toBe(false);
    expect(result.amountSats).toBe(1000);
  });

  it("lookupInvoice floors msats to sats conversion", async () => {
    vi.mocked(mockTransport.lookupInvoice).mockResolvedValue({
      settled_at: 1700000000,
      preimage: "pre",
      amount: 1_500, // 1.5 sats → floors to 1
    });

    const provider = await getProvider();
    const result = await provider.lookupInvoice({ paymentHash: "hash" });

    expect(result.amountSats).toBe(1);
  });

  it("close delegates to transport", async () => {
    const provider = await getProvider();
    provider.close();
    expect(mockTransport.close).toHaveBeenCalled();
  });
});
