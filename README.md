# @trepa/sdk

Trepa SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.io/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Quickstart

The SDK wraps every REST endpoint in the [API reference](https://docs.trepa.io/developers/api-endpoints) with full TypeScript types and built-in Solana transaction signing. On top of that, it exposes a declarative interface for writing bots: you provide a `predict(pool)` function, the SDK handles the rest:

```ts
import { Trepa } from '@trepa/sdk';

const trepa = new Trepa({
  apiKey: process.env.TREPA_API_KEY!,
  privateKey: process.env.TREPA_PRIVATE_KEY!,
});

await trepa.bot.run({
  predict: (pool) => ({
    value: (pool.min_outcome + pool.max_outcome) / 2,
    stake: pool.min_stake,
  }),
});
```

In simple terms, bots place a prediction on every open pool using your function and keeps going until you stop it.

## Examples

- [`examples/liquidity-bot`](./examples/liquidity-bot): a minimal liquidity-bootstrapping bot for the Bitcoin streak. Reads the live BTCUSDT spot price from Binance's public REST endpoint, adds a small random jitter so concurrent bots don't all land on the same tick, and submits a min-stake prediction on every open pool.

## License

[MIT](./LICENSE)
