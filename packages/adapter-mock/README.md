# @ambosstech/lightning-mpp-adapter-mock

Mock adapter for the [Lightning MPP SDK](https://www.npmjs.com/package/@ambosstech/lightning-mpp-sdk). Test the full payment flow without a real Lightning node.

## Installation

```bash
pnpm add @ambosstech/lightning-mpp-sdk @ambosstech/lightning-mpp-adapter-mock
```

## Usage

```ts
import { MockLightningProvider } from "@ambosstech/lightning-mpp-adapter-mock";

// Auto-settles invoices on lookup (default)
const provider = new MockLightningProvider({ autoSettle: true });

// Create and pay invoices
const { bolt11, paymentHash } = await provider.createInvoice({ amountSats: 1000 });
const { preimage } = await provider.payInvoice({ bolt11 });
const { settled } = await provider.lookupInvoice({ paymentHash });
```

### Test failure scenarios

```ts
// Payments always fail
const failProvider = new MockLightningProvider({ failOnPay: true });

// Simulate slow payments
const slowProvider = new MockLightningProvider({ paymentDelay: 2000 });

// Manual settlement control
const manualProvider = new MockLightningProvider({ autoSettle: false });
manualProvider.settleInvoice(paymentHash);
```

## Options

| Option         | Type      | Default | Description                                    |
| -------------- | --------- | ------- | ---------------------------------------------- |
| `autoSettle`   | `boolean` | `true`  | Auto-mark invoices as settled on lookup        |
| `failOnPay`    | `boolean` | `false` | Throw `RouteNotFoundError` on payment          |
| `paymentDelay` | `number`  | `0`     | Artificial delay in ms before payment resolves |

## License

MIT
