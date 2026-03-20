# @ambosstech/lightning-mpp-sdk

Core SDK for Lightning Network payments using [MPP](https://mpp.dev) (Machine Payments Protocol).

MPP lets any HTTP API accept payments using the standard `402 Payment Required` flow. This SDK provides the method definitions, provider interface, store, and error classes — pair it with an adapter to connect to your Lightning node or wallet.

## Installation

```bash
pnpm add @ambosstech/lightning-mpp-sdk
```

You'll also need an adapter:

- [`@ambosstech/lightning-mpp-adapter-lnd`](https://www.npmjs.com/package/@ambosstech/lightning-mpp-adapter-lnd) — LND (gRPC + REST)
- [`@ambosstech/lightning-mpp-adapter-nwc`](https://www.npmjs.com/package/@ambosstech/lightning-mpp-adapter-nwc) — Nostr Wallet Connect (NIP-47)
- [`@ambosstech/lightning-mpp-adapter-mock`](https://www.npmjs.com/package/@ambosstech/lightning-mpp-adapter-mock) — Mock for testing

## Usage

### Server — charge (one-time payment)

```ts
import { Mppx } from "mppx";
import { lightningChargeServer, createMemoryStore } from "@ambosstech/lightning-mpp-sdk";
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!,
});

const chargeMethod = lightningChargeServer({
  provider,
  currency: "sat",
  network: "mainnet",
});

const mppx = Mppx.create({
  methods: [chargeMethod],
  secretKey: process.env.MPP_SECRET_KEY!,
});

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

const mppx = Mppx.create({ polyfill: false, methods: [chargeClient] });
const response = await mppx.fetch("https://api.example.com/weather");
```

## Provider interface

Implement `LightningProvider` to add support for any Lightning node or wallet:

```ts
import type { LightningProvider } from "@ambosstech/lightning-mpp-sdk";

class MyProvider implements LightningProvider {
  async createInvoice(params: { amountSats: number; memo?: string; expirySecs?: number }) {
    // Return { bolt11: string, paymentHash: string }
  }
  async payInvoice(params: { bolt11: string; amountSats?: number; maxFeeSats?: number; timeoutSecs?: number }) {
    // Return { preimage: string }
  }
  async lookupInvoice(params: { paymentHash: string }) {
    // Return { settled: boolean, preimage?: string, amountSats?: number }
  }
}
```

## Error handling

```ts
import {
  InsufficientBalanceError,
  InvoiceExpiredError,
  RouteNotFoundError,
  PaymentTimeoutError,
  ConnectionError,
  AuthenticationError,
} from "@ambosstech/lightning-mpp-sdk";
```

| Error                      | Code                   | When                             |
| -------------------------- | ---------------------- | -------------------------------- |
| `InsufficientBalanceError` | `INSUFFICIENT_BALANCE` | Not enough local balance         |
| `InvoiceExpiredError`      | `INVOICE_EXPIRED`      | Invoice TTL has elapsed          |
| `RouteNotFoundError`       | `ROUTE_NOT_FOUND`      | No route to destination          |
| `PaymentTimeoutError`      | `PAYMENT_TIMEOUT`      | Payment did not complete in time |
| `ConnectionError`          | `CONNECTION_ERROR`     | Cannot reach the Lightning node  |
| `AuthenticationError`      | `AUTHENTICATION_ERROR` | Invalid credentials              |

## License

MIT
