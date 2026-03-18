# Lightning MPP SDK

A provider-agnostic Lightning Network payment method for [MPP](https://mpp.dev) (Machine Payments Protocol).

> **Note for Lightning developers:** "MPP" here refers to **Machine Payments Protocol**, an open HTTP payment standard — not [Multi-Path Payments](https://bitcoinops.org/en/topics/multipath-payments/) (BOLT #4).

MPP lets any HTTP API accept payments using the standard `402 Payment Required` flow. This SDK implements the Lightning payment method with a pluggable provider architecture — bring your own LND node, or swap in any Lightning implementation.

## How it works

```
Client                          Server
  │                                 │
  │────── GET /resource ───────────>│
  │                                 │
  │<──── 402 + BOLT11 invoice ──────│  server generates invoice via provider
  │                                 │
  │   (pay invoice over Lightning)  │
  │                                 │
  │─── GET /resource + preimage ───>│
  │                                 │  server verifies sha256(preimage) == paymentHash
  │<────── 200 + resource ──────────│
  │                                 │
```

No external payment processor. No polling. No webhooks. The preimage _is_ the proof of payment.

## Packages

| Package                                  | Description                                                      |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `@ambosstech/lightning-mpp-sdk`         | Core SDK — method definitions, provider interface, store, errors |
| `@ambosstech/lightning-mpp-adapter-lnd`  | LND adapter — gRPC and REST transports                           |
| `@ambosstech/lightning-mpp-adapter-mock` | Mock adapter — for testing without a real Lightning node         |

## Quick start

### Installation

```bash
# Core + LND adapter
pnpm add @ambosstech/lightning-mpp-sdk @ambosstech/lightning-mpp-adapter-lnd mppx

# Or core + mock for testing
pnpm add @ambosstech/lightning-mpp-sdk @ambosstech/lightning-mpp-adapter-mock mppx
```

### Server — charge (one-time payment)

Uses the Web-standard `Request`/`Response` API — works with Node.js, Cloudflare Workers, Next.js, Bun, Deno, and any other runtime.

```ts
import { Mppx } from "mppx";
import {
  lightningChargeServer,
  createMemoryStore,
} from "@ambosstech/lightning-mpp-sdk";
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

// 1. Create a provider (LND in this example)
const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!,
});

// 2. Create the server-side charge method
const chargeMethod = lightningChargeServer({
  provider,
  currency: "sat",
  network: "mainnet",
});

// 3. Wire it into mppx
const mppx = Mppx.create({
  methods: [chargeMethod],
  secretKey: process.env.MPP_SECRET_KEY!,
});

// 4. Use in your request handler
export async function handler(request: Request): Promise<Response> {
  const result = await mppx.charge({
    amount: "100",
    currency: "sat",
    description: "Premium API access",
  })(request);

  if (result.status === 402) return result.challenge;

  return result.withReceipt(Response.json({ data: "..." }));
}
```

### Client — charge (one-time payment)

The MPP client intercepts `402` responses automatically — paying invoices and retrying with credentials before returning the final response.

```ts
import { Mppx } from "mppx";
import { lightningChargeClient } from "@ambosstech/lightning-mpp-sdk";
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!,
});

const chargeClient = lightningChargeClient(provider, {
  maxFeeSats: 100,
  onProgress: (event) => console.log(event.type),
});

const mppx = Mppx.create({
  polyfill: false,
  methods: [chargeClient],
});

const response = await mppx.fetch("https://api.example.com/weather");
console.log(await response.json());
```

### Server — session (prepaid metered access)

Sessions let clients deposit a lump sum and make multiple requests, with per-request billing deducted from the balance. Supports mid-stream top-ups and refunds on close.

```ts
import { Mppx } from "mppx";
import {
  lightningSessionServer,
  createMemoryStore,
} from "@ambosstech/lightning-mpp-sdk";
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!,
});

const sessionMethod = lightningSessionServer({
  provider,
  depositAmount: 300, // sats required upfront
  idleTimeout: 300, // auto-close after 5 min inactivity
  unitType: "chunk",
});

const mppx = Mppx.create({
  methods: [sessionMethod],
  secretKey: process.env.MPP_SECRET_KEY!,
});

export async function handler(request: Request): Promise<Response> {
  const result = await mppx.session({
    amount: "2", // 2 sats per chunk
    currency: "sat",
    description: "LLM stream",
  })(request);

  if (result.status === 402) return result.challenge;

  // Use the built-in serve() for automatic per-chunk billing over SSE
  return result.withReceipt(
    sessionMethod.serve({
      sessionId: "...", // from the credential
      satsPerChunk: 2,
      generate: myAsyncGenerator(),
      timeoutMs: 60_000, // wait 60s for top-up before closing
    }),
  );
}
```

The `serve()` method handles the full SSE lifecycle:

- Deducts `satsPerChunk` from the session balance for each yielded value
- Emits `payment-need-topup` when balance is exhausted
- Holds the connection open until the client tops up or timeout elapses
- Emits `payment-receipt` and `[DONE]` on stream completion

### Client — session

```ts
import { Mppx } from "mppx";
import { lightningSessionClient } from "@ambosstech/lightning-mpp-sdk";
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!,
});

const sessionClient = lightningSessionClient(provider, {
  maxFeeSats: 100,
  onProgress: (event) => console.log(event.type),
});

const mppx = Mppx.create({
  polyfill: false,
  methods: [sessionClient],
});

// First request opens the session and pays the deposit
const response1 = await mppx.fetch("https://api.example.com/generate");

// Subsequent requests reuse the session (bearer auth, no payment)
const response2 = await mppx.fetch("https://api.example.com/generate");

// Top up if balance is exhausted mid-stream
await sessionClient.topUp(mppx.fetch, "https://api.example.com/generate");

// Close the session and get a refund for unspent balance
const closeResponse = await sessionClient.close(
  mppx.fetch,
  "https://api.example.com/generate",
);
const { refundSats } = await closeResponse.json();
```

## Testing with the mock adapter

The mock adapter lets you test the full payment flow without a real Lightning node:

```ts
import {
  lightningChargeServer,
  lightningChargeClient,
  createMemoryStore,
} from "@ambosstech/lightning-mpp-sdk";
import { MockLightningProvider } from "@ambosstech/lightning-mpp-adapter-mock";

// Server-side mock (auto-settles invoices)
const serverProvider = new MockLightningProvider({ autoSettle: true });
const server = lightningChargeServer({ provider: serverProvider });

// Client-side mock (pays invoices instantly)
const clientProvider = new MockLightningProvider();
const client = lightningChargeClient(clientProvider);

// Test failure scenarios
const failProvider = new MockLightningProvider({ failOnPay: true });
const failClient = lightningChargeClient(failProvider);

// Simulate slow payments
const slowProvider = new MockLightningProvider({ paymentDelay: 2000 });
```

### Mock provider options

| Option         | Type      | Default | Description                                    |
| -------------- | --------- | ------- | ---------------------------------------------- |
| `autoSettle`   | `boolean` | `true`  | Auto-mark invoices as settled on lookup        |
| `failOnPay`    | `boolean` | `false` | Throw `RouteNotFoundError` on payment          |
| `paymentDelay` | `number`  | `0`     | Artificial delay in ms before payment resolves |

## LND adapter configuration

### gRPC transport

```ts
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";
import { readFileSync } from "node:fs";

const provider = new LndLightningProvider({
  transport: "grpc",
  host: "127.0.0.1:10009",
  tlsCert: readFileSync("/path/to/tls.cert"),
  macaroon: readFileSync("/path/to/admin.macaroon"),
});
```

### REST transport

```ts
const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!, // hex-encoded
  fetch: customFetchWithTLS, // optional: custom fetch for TLS cert handling
});
```

## Provider interface

Implement `LightningProvider` to add support for any Lightning node or wallet:

```ts
import type { LightningProvider } from "@ambosstech/lightning-mpp-sdk";

class MyCustomProvider implements LightningProvider {
  async createInvoice(params: {
    amountSats: number;
    memo?: string;
    expirySecs?: number;
  }) {
    // Return { bolt11: string, paymentHash: string }
  }

  async payInvoice(params: {
    bolt11: string;
    amountSats?: number; // required for 0-amount invoices (e.g. session refunds)
    maxFeeSats?: number;
    timeoutSecs?: number;
  }) {
    // Return { preimage: string }
  }

  async lookupInvoice(params: { paymentHash: string }) {
    // Return { settled: boolean, preimage?: string, amountSats?: number }
  }
}
```

## Pluggable store

Session state and consume-once tracking use a `KeyValueStore` interface. The default is in-memory — swap it for Redis, Cloudflare KV, DynamoDB, etc. in production:

```ts
import type { KeyValueStore } from "@ambosstech/lightning-mpp-sdk";

const redisStore: KeyValueStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : undefined;
  },
  async put<T>(key: string, value: T): Promise<void> {
    await redis.set(key, JSON.stringify(value));
  },
};

const server = lightningChargeServer({ provider, store: redisStore });
```

## Error handling

The SDK provides typed error classes for common Lightning failure modes:

```ts
import {
  LightningError,
  InsufficientBalanceError,
  InvoiceExpiredError,
  RouteNotFoundError,
  PaymentTimeoutError,
  ConnectionError,
  AuthenticationError,
} from "@ambosstech/lightning-mpp-sdk";

try {
  await provider.payInvoice({ bolt11: invoice });
} catch (error) {
  if (error instanceof RouteNotFoundError) {
    // No path to destination — retry later or use a different route
  } else if (error instanceof PaymentTimeoutError) {
    // Payment did not complete in time
  } else if (error instanceof InsufficientBalanceError) {
    // Not enough local balance to send
  }
}
```

| Error                      | Code                   | When                             |
| -------------------------- | ---------------------- | -------------------------------- |
| `InsufficientBalanceError` | `INSUFFICIENT_BALANCE` | Not enough local balance         |
| `InvoiceExpiredError`      | `INVOICE_EXPIRED`      | Invoice TTL has elapsed          |
| `RouteNotFoundError`       | `ROUTE_NOT_FOUND`      | No route to destination          |
| `PaymentTimeoutError`      | `PAYMENT_TIMEOUT`      | Payment did not complete in time |
| `ConnectionError`          | `CONNECTION_ERROR`     | Cannot reach the Lightning node  |
| `AuthenticationError`      | `AUTHENTICATION_ERROR` | Invalid macaroon or credentials  |

## API reference

### Charge method

#### `lightningChargeServer(options)`

| Option              | Type                | Default      | Description                                        |
| ------------------- | ------------------- | ------------ | -------------------------------------------------- |
| `provider`          | `LightningProvider` | **required** | Lightning node adapter                             |
| `store`             | `KeyValueStore`     | in-memory    | For consume-once tracking                          |
| `currency`          | `string`            | `"sat"`      | Currency code sent in challenges                   |
| `network`           | `string`            | —            | Network name sent in challenges (e.g. `"mainnet"`) |
| `invoiceExpirySecs` | `number`            | `3600`       | Invoice TTL in seconds                             |

#### `lightningChargeClient(provider, options?)`

| Option       | Type              | Default | Description                                       |
| ------------ | ----------------- | ------- | ------------------------------------------------- |
| `maxFeeSats` | `number`          | —       | Maximum routing fee                               |
| `onProgress` | `(event) => void` | —       | Progress callback (`challenge`, `paying`, `paid`) |

### Session method

#### `lightningSessionServer(options)`

| Option          | Type                | Default       | Description                                |
| --------------- | ------------------- | ------------- | ------------------------------------------ |
| `provider`      | `LightningProvider` | **required**  | Lightning node adapter                     |
| `store`         | `KeyValueStore`     | in-memory     | For session state                          |
| `currency`      | `string`            | `"sat"`       | Currency code                              |
| `depositAmount` | `number`            | `amount * 20` | Deposit size in sats                       |
| `unitType`      | `string`            | —             | Label for the priced unit (e.g. `"token"`) |
| `idleTimeout`   | `number`            | `300`         | Idle timeout in seconds (0 to disable)     |

Returns the method plus `{ deduct, waitForTopUp, serve }`:

- **`deduct(sessionId, sats)`** — Deducts from balance. Returns `true` on success, `false` if insufficient.
- **`waitForTopUp(sessionId, timeoutMs?)`** — Waits for a top-up. Returns `true` if topped up, `false` on timeout.
- **`serve({ sessionId, satsPerChunk, generate, timeoutMs? })`** — Returns an SSE `Response` with automatic per-chunk billing.

#### `lightningSessionClient(provider, options?)`

| Option       | Type              | Default | Description                                                        |
| ------------ | ----------------- | ------- | ------------------------------------------------------------------ |
| `maxFeeSats` | `number`          | —       | Maximum routing fee                                                |
| `onProgress` | `(event) => void` | —       | Progress callback (`opening`, `bearer`, `topping-up`, `topped-up`) |

Returns the method plus `{ close, topUp, getSession, resetSession }`:

- **`topUp(fetch, url)`** — Pays a new deposit invoice to add balance.
- **`close(fetch, url)`** — Closes the session and triggers a refund.
- **`getSession()`** — Returns `{ sessionId }` or `null`.
- **`resetSession()`** — Clears local state (for server-initiated closes).

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+

### Setup

```bash
git clone https://github.com/ambosstech/lightning-mpp-sdk.git
cd lightning-mpp-sdk
pnpm install
```

### Commands

```bash
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm test:watch     # Run tests in watch mode
pnpm typecheck      # TypeScript type checking
pnpm lint           # ESLint
pnpm format         # Prettier
```

### Project structure

```
lightning-mpp-sdk/
├── packages/
│   ├── sdk/                # Core SDK — methods, provider interface, store, errors
│   │   └── src/
│   │       ├── methods/     # charge.ts, session.ts (client + server)
│   │       ├── session/     # SessionStateManager (low-level API)
│   │       ├── provider.ts  # LightningProvider interface
│   │       ├── store.ts     # KeyValueStore interface
│   │       ├── errors.ts    # Typed error classes
│   │       └── preimage.ts  # Crypto utilities (sha256 verification, hex/base64)
│   ├── adapter-lnd/         # LND adapter (gRPC + REST)
│   └── adapter-mock/        # Mock adapter for testing
├── package.json             # Workspace root
├── pnpm-workspace.yaml
├── turbo.json               # Build orchestration
└── tsconfig.base.json       # Shared TypeScript config
```

## Specifications

The Lightning payment method is defined in two IETF-formatted specifications within the [HTTP Payment Authentication](https://paymentauth.org) framework:

- [`draft-lightning-charge-00`](https://paymentauth.org/draft-lightning-charge-00.html) — One-time BOLT11 invoice payments
- [`draft-lightning-session-00`](https://paymentauth.org/draft-lightning-session-00.html) — Prepaid sessions with per-unit billing and refund on close

## License

MIT
