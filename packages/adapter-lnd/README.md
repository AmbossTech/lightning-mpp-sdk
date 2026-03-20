# @ambosstech/lightning-mpp-adapter-lnd

LND adapter for the [Lightning MPP SDK](https://www.npmjs.com/package/@ambosstech/lightning-mpp-sdk). Supports both gRPC and REST transports.

## Installation

```bash
pnpm add @ambosstech/lightning-mpp-sdk @ambosstech/lightning-mpp-adapter-lnd
```

## Usage

### REST transport

```ts
import { LndLightningProvider } from "@ambosstech/lightning-mpp-adapter-lnd";

const provider = new LndLightningProvider({
  transport: "rest",
  url: "https://127.0.0.1:8080",
  macaroon: process.env.LND_MACAROON!, // hex-encoded
  fetch: customFetchWithTLS, // optional: custom fetch for TLS cert handling
});
```

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

### With the SDK

```ts
import { lightningChargeServer } from "@ambosstech/lightning-mpp-sdk";

const chargeMethod = lightningChargeServer({
  provider,
  currency: "sat",
  network: "mainnet",
});
```

## License

MIT
