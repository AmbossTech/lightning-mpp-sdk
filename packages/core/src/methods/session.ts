import { Credential, Method, Receipt, z } from "mppx";
import type { LightningProvider } from "../provider.js";
import { verifyPreimage } from "../preimage.js";
import { createMemoryStore, type KeyValueStore } from "../store.js";

// ---------------------------------------------------------------------------
// Session state (persisted in the pluggable store)
// ---------------------------------------------------------------------------

type SessionState = {
  paymentHash: string;
  depositSats: number;
  spent: number;
  returnInvoice: string;
  status: "open" | "closed";
  refundSats?: number;
  refundStatus?: "succeeded" | "failed" | "skipped";
};

function storeKey(sessionId: string): string {
  return `lightning-session:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Shared method definition — wire-format compatible with Spark SDK
// ---------------------------------------------------------------------------

export const lightningSession = Method.from({
  intent: "session" as const,
  name: "lightning" as const,
  schema: {
    credential: {
      payload: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("open"),
          preimage: z.string(),
          returnInvoice: z.string(),
        }),
        z.object({
          action: z.literal("bearer"),
          sessionId: z.string(),
          preimage: z.string(),
        }),
        z.object({
          action: z.literal("topUp"),
          sessionId: z.string(),
          topUpPreimage: z.string(),
        }),
        z.object({
          action: z.literal("close"),
          sessionId: z.string(),
          preimage: z.string(),
        }),
      ]),
    },
    request: z.object({
      amount: z.string(),
      currency: z.string(),
      description: z.optional(z.string()),
      unitType: z.optional(z.string()),
      depositInvoice: z.optional(z.string()),
      paymentHash: z.string(),
      depositAmount: z.optional(z.string()),
      idleTimeout: z.optional(z.string()),
    }),
  },
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type LightningSessionClientProgress =
  | { type: "opening"; depositSats: number; amount: number }
  | { type: "bearer"; amount: number }
  | { type: "topping-up"; topUpSats: number }
  | { type: "topped-up"; topUpSats: number };

type ActiveSession = {
  sessionId: string;
  preimage: string;
};

/**
 * Creates a client-side session method.
 *
 * Handles the full session lifecycle: open (deposit payment), bearer (reuse
 * preimage), topUp (additional deposits), and close (trigger refund).
 */
export function lightningSessionClient(
  provider: LightningProvider,
  options?: {
    maxFeeSats?: number;
    onProgress?: (event: LightningSessionClientProgress) => void;
  },
) {
  const { maxFeeSats, onProgress } = options ?? {};

  let activeSession: ActiveSession | null = null;
  let pendingClose = false;
  let pendingTopUp = false;

  const method = Method.toClient(lightningSession, {
    async createCredential({ challenge }) {
      const { amount, depositAmount, depositInvoice, paymentHash } =
        challenge.request;

      // Top-up action — pay new deposit invoice.
      if (activeSession && pendingTopUp) {
        pendingTopUp = false;
        const topUpSats = parseInt((depositAmount ?? "0") as string, 10);
        onProgress?.({ type: "topping-up", topUpSats });

        const topUpResult = await provider.payInvoice({
          bolt11: depositInvoice as string,
          maxFeeSats,
        });

        onProgress?.({ type: "topped-up", topUpSats });

        return Credential.serialize({
          challenge,
          payload: {
            action: "topUp" as const,
            sessionId: activeSession.sessionId,
            topUpPreimage: topUpResult.preimage,
          },
        });
      }

      // Close action — send close credential and clear session.
      if (activeSession && pendingClose) {
        const { sessionId, preimage } = activeSession;
        pendingClose = false;
        activeSession = null;
        return Credential.serialize({
          challenge,
          payload: { action: "close" as const, sessionId, preimage },
        });
      }

      // Ongoing session — present preimage as bearer token.
      if (activeSession) {
        onProgress?.({ type: "bearer", amount: parseInt(amount, 10) });
        return Credential.serialize({
          challenge,
          payload: {
            action: "bearer" as const,
            sessionId: activeSession.sessionId,
            preimage: activeSession.preimage,
          },
        });
      }

      // New session — pay deposit invoice and create return invoice for refunds.
      const depositSats = parseInt((depositAmount ?? "0") as string, 10);
      onProgress?.({
        type: "opening",
        depositSats,
        amount: parseInt(amount, 10),
      });

      const [payResult, returnInvoiceResult] = await Promise.all([
        provider.payInvoice({
          bolt11: depositInvoice as string,
          maxFeeSats,
        }),
        provider.createInvoice({
          amountSats: 0,
          memo: "Session refund",
          expirySecs: 60 * 60 * 24 * 30, // 30 days
        }),
      ]);

      const preimage = payResult.preimage;
      const sessionId = paymentHash as string;
      const returnInvoice = returnInvoiceResult.bolt11;

      activeSession = { sessionId, preimage };

      return Credential.serialize({
        challenge,
        payload: {
          action: "open" as const,
          preimage,
          returnInvoice,
        },
      });
    },
  });

  /**
   * Tops up the active session by paying a new deposit invoice.
   * Use this when the session balance is exhausted.
   */
  async function topUp(
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    url: string,
  ): Promise<Response> {
    if (!activeSession) throw new Error("No active session to top up");
    pendingTopUp = true;
    try {
      return await fetch(url);
    } catch (err) {
      pendingTopUp = false;
      throw err;
    }
  }

  /**
   * Closes the active session, triggering a refund from the server.
   */
  async function close(
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    url: string,
  ): Promise<Response> {
    if (!activeSession) throw new Error("No active session to close");
    pendingClose = true;
    try {
      return await fetch(url);
    } catch (err) {
      pendingClose = false;
      throw err;
    }
  }

  /** Returns the active session ID, or null if no session is open. */
  function getSession(): { sessionId: string } | null {
    return activeSession ? { sessionId: activeSession.sessionId } : null;
  }

  /**
   * Clears local session state without sending a close credential.
   * Use when the server has already closed the session (e.g. idle timeout).
   */
  function resetSession(): void {
    activeSession = null;
    pendingClose = false;
    pendingTopUp = false;
  }

  return Object.assign(method, { close, topUp, getSession, resetSession });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Creates a server-side session method.
 *
 * Manages the full session lifecycle: deposit verification, bearer auth,
 * top-up handling, idle timeouts, and refund on close.
 */
export function lightningSessionServer(options: {
  provider: LightningProvider;
  store?: KeyValueStore;
  currency?: string;
  depositAmount?: number;
  unitType?: string;
  idleTimeout?: number;
}) {
  const {
    provider,
    store = createMemoryStore(),
    currency = "sat",
    depositAmount: configuredDepositAmount,
    unitType,
    idleTimeout: idleTimeoutSecs = 300,
  } = options;

  const idleTimeoutMs = idleTimeoutSecs > 0 ? idleTimeoutSecs * 1000 : 0;

  // Per-session waiters for top-up notifications.
  const waiters = new Map<string, Set<() => void>>();
  // Per-session idle timers.
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function notify(sessionId: string): void {
    const set = waiters.get(sessionId);
    if (!set) return;
    for (const resolve of set) resolve();
    waiters.delete(sessionId);
  }

  function clearIdleTimer(sessionId: string): void {
    const timer = idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(sessionId);
    }
  }

  function resetIdleTimer(sessionId: string): void {
    if (!idleTimeoutMs) return;
    clearIdleTimer(sessionId);
    const timer = setTimeout(async () => {
      idleTimers.delete(sessionId);
      await closeSession(sessionId);
    }, idleTimeoutMs);
    idleTimers.set(sessionId, timer);
  }

  /**
   * Closes an open session and attempts to refund unspent balance.
   * Marks the session closed atomically before attempting payment.
   */
  async function closeSession(sessionId: string): Promise<void> {
    const state = await store.get<SessionState>(storeKey(sessionId));
    if (!state || state.status !== "open") return;

    const refundSats = Math.max(state.depositSats - state.spent, 0);
    const closedState: SessionState = { ...state, status: "closed" };
    await store.put(storeKey(sessionId), closedState);

    let refundStatus: "succeeded" | "failed" | "skipped";
    if (refundSats > 0) {
      try {
        await provider.payInvoice({
          bolt11: state.returnInvoice,
          maxFeeSats: 100,
        });
        refundStatus = "succeeded";
      } catch {
        refundStatus = "failed";
      }
    } else {
      refundStatus = "skipped";
    }

    await store.put(storeKey(sessionId), {
      ...closedState,
      refundSats,
      refundStatus,
    });
  }

  /**
   * Deducts sats from the session balance.
   * Returns true if deduction succeeded, false if insufficient balance.
   */
  async function deduct(sessionId: string, sats: number): Promise<boolean> {
    const state = await store.get<SessionState>(storeKey(sessionId));
    if (!state) throw new Error(`Session not found: ${sessionId}`);
    if (state.status !== "open") throw new Error("Session is already closed");
    const available = state.depositSats - state.spent;
    if (available < sats) return false;
    await store.put(storeKey(sessionId), {
      ...state,
      spent: state.spent + sats,
    });
    resetIdleTimer(sessionId);
    return true;
  }

  /**
   * Waits for the next top-up on a session.
   * Returns true if a top-up arrived, false on timeout.
   */
  function waitForTopUp(
    sessionId: string,
    timeoutMs = 60_000,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const onUpdate = () => {
        clearTimeout(timer);
        resolve(true);
      };

      const timer = setTimeout(() => {
        const set = waiters.get(sessionId);
        if (set) {
          set.delete(onUpdate);
          if (set.size === 0) waiters.delete(sessionId);
        }
        resolve(false);
      }, timeoutMs);

      let set = waiters.get(sessionId);
      if (!set) {
        set = new Set();
        waiters.set(sessionId, set);
      }
      set.add(onUpdate);
    });
  }

  const method = Method.toServer(lightningSession, {
    defaults: {
      currency,
      paymentHash: "",
    },

    async request({ credential, request }) {
      if (credential) {
        return credential.challenge.request as typeof request;
      }

      const pricePerUnit = parseInt(request.amount, 10);
      const depositSats = configuredDepositAmount ?? pricePerUnit * 20;

      const { bolt11, paymentHash } = await provider.createInvoice({
        amountSats: depositSats,
        memo: request.description ?? "Session deposit",
      });

      return {
        ...request,
        depositInvoice: bolt11,
        paymentHash,
        depositAmount: String(depositSats),
        ...(unitType !== undefined && { unitType }),
        ...(idleTimeoutMs > 0 && { idleTimeout: String(idleTimeoutSecs) }),
      };
    },

    async verify({ credential, request }) {
      const { payload } = credential;

      if (payload.action === "open") {
        const actualHash = credential.challenge.request.paymentHash;
        const isValid = verifyPreimage(payload.preimage, actualHash);
        if (!isValid) {
          throw new Error(
            `Invalid preimage for open: does not match ${actualHash}`,
          );
        }

        const depositSats = parseInt(
          (request.depositAmount as string) ?? "0",
          10,
        );
        const sessionId = actualHash;
        const pricePerUnit = parseInt(request.amount, 10);

        // Consume-once: prevent replay of open credential (balance reset attack).
        const openConsumedKey = `lightning-session:consumed:${sessionId}`;
        if (await store.get(openConsumedKey)) {
          throw new Error(
            `Deposit invoice already consumed for session: ${sessionId}`,
          );
        }
        await store.put(openConsumedKey, true);

        if (depositSats < pricePerUnit) {
          throw new Error(
            `Deposit (${depositSats} sat) is less than cost per request (${pricePerUnit} sat)`,
          );
        }

        const state: SessionState = {
          paymentHash: sessionId,
          depositSats,
          spent: 0,
          returnInvoice: payload.returnInvoice,
          status: "open",
        };
        await store.put(storeKey(sessionId), state);
        resetIdleTimer(sessionId);

        return Receipt.from({
          method: "lightning",
          reference: sessionId,
          status: "success",
          timestamp: new Date().toISOString(),
        });
      }

      if (payload.action === "bearer") {
        const state = await store.get<SessionState>(
          storeKey(payload.sessionId),
        );
        if (!state) throw new Error(`Session not found: ${payload.sessionId}`);
        if (state.status !== "open")
          throw new Error("Session is already closed");

        const isValid = verifyPreimage(payload.preimage, state.paymentHash);
        if (!isValid) {
          throw new Error(
            "Invalid session credential: preimage does not match session",
          );
        }
        resetIdleTimer(payload.sessionId);

        return Receipt.from({
          method: "lightning",
          reference: payload.sessionId,
          status: "success",
          timestamp: new Date().toISOString(),
        });
      }

      if (payload.action === "topUp") {
        const state = await store.get<SessionState>(
          storeKey(payload.sessionId),
        );
        if (!state) throw new Error(`Session not found: ${payload.sessionId}`);
        if (state.status !== "open")
          throw new Error("Session is already closed");

        const topUpHash = credential.challenge.request.paymentHash;
        const isValid = verifyPreimage(payload.topUpPreimage, topUpHash);
        if (!isValid) {
          throw new Error(
            `Invalid top-up preimage: does not match ${topUpHash}`,
          );
        }

        const topUpSats = parseInt(
          (request.depositAmount as string) ?? "0",
          10,
        );

        // Consume-once: prevent double-crediting the same top-up invoice.
        const topUpConsumedKey = `lightning-session:consumed:${topUpHash}`;
        if (await store.get(topUpConsumedKey)) {
          throw new Error("Top-up invoice already consumed");
        }
        await store.put(topUpConsumedKey, true);

        await store.put(storeKey(payload.sessionId), {
          ...state,
          depositSats: state.depositSats + topUpSats,
        });

        notify(payload.sessionId);
        resetIdleTimer(payload.sessionId);

        return Receipt.from({
          method: "lightning",
          reference: payload.sessionId,
          status: "success",
          timestamp: new Date().toISOString(),
        });
      }

      if (payload.action === "close") {
        const state = await store.get<SessionState>(
          storeKey(payload.sessionId),
        );
        if (!state) throw new Error(`Session not found: ${payload.sessionId}`);
        if (state.status !== "open")
          throw new Error("Session is already closed");

        const isValid = verifyPreimage(payload.preimage, state.paymentHash);
        if (!isValid) {
          throw new Error(
            "Invalid session credential: preimage does not match session",
          );
        }

        clearIdleTimer(payload.sessionId);
        await closeSession(payload.sessionId);

        return Receipt.from({
          method: "lightning",
          reference: payload.sessionId,
          status: "success",
          timestamp: new Date().toISOString(),
        });
      }

      throw new Error("Unknown session action");
    },

    async respond({ credential }) {
      const { payload } = credential;

      // topUp: short-circuit — the stream resumes via notify().
      if (payload.action === "topUp") {
        return Response.json({ status: "ok" });
      }

      // close: return the refund summary.
      if (payload.action === "close") {
        const state = await store.get<SessionState>(
          storeKey(payload.sessionId),
        );
        const refundSats =
          state?.refundSats ??
          Math.max((state?.depositSats ?? 0) - (state?.spent ?? 0), 0);
        const refundStatus = state?.refundStatus ?? "skipped";
        return Response.json({ status: "closed", refundSats, refundStatus });
      }
    },
  });

  return Object.assign(method, { deduct, waitForTopUp });
}
