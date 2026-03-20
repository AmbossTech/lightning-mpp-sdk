# @ambosstech/lightning-mpp-adapter-nwc

[Nostr Wallet Connect](https://github.com/nostr-protocol/nips/blob/master/47.md) (NIP-47) adapter for the [Lightning MPP SDK](https://www.npmjs.com/package/@ambosstech/lightning-mpp-sdk). Connect to any NWC-compatible wallet — Alby Hub, coinos, Primal, etc.

## Installation

```bash
pnpm add @ambosstech/lightning-mpp-sdk @ambosstech/lightning-mpp-adapter-nwc
```

## Usage

```ts
import { NwcLightningProvider } from "@ambosstech/lightning-mpp-adapter-nwc";

const provider = new NwcLightningProvider({
  connectionString: "nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex",
  timeoutSecs: 60, // optional, default 60
});

// Use like any other provider
const invoice = await provider.createInvoice({ amountSats: 1000, memo: "test" });
const { preimage } = await provider.payInvoice({ bolt11: invoice.bolt11 });
const lookup = await provider.lookupInvoice({ paymentHash: invoice.paymentHash });

// Clean up when done
provider.close();
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

## Configuration

| Option             | Type     | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `connectionString` | `string` | —       | NWC connection URI (required)        |
| `timeoutSecs`      | `number` | `60`    | Response timeout in seconds          |

The connection string is provided by your wallet and contains the wallet pubkey, relay URL, and client secret. All communication is encrypted with NIP-44.

## Notes

- **Unit conversion**: The SDK uses satoshis; NWC uses millisatoshis. Conversion is handled automatically.
- **`maxFeeSats`**: NWC does not support fee limits — fees are controlled by the wallet. A warning is logged if provided.
- **Connection lifecycle**: The relay connection is established lazily on the first request. Call `provider.close()` to disconnect.

## License

MIT
