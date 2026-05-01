# @trepa/sdk

Trepa SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.io/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Quickstart

The SDK wraps every REST endpoint in the [API reference](https://docs.trepa.io/developers/api-endpoints) with full TypeScript types and built-in Solana transaction signing. On top of that, it exposes a declarative interface for writing bots:

```ts
import { Trepa } from '@trepa/sdk';

const trepa = new Trepa({
  credentials: [
    { apiKey: '...', privateKey: '...' },
    { apiKey: '...', privateKey: '...' },
    { apiKey: '...', privateKey: '...' },
  ],
});

await trepa.bots.run(({ index, count }) => ({
  predict: (pool) => ({
    value:
      pool.min_outcome +
      ((index + 0.5) / count) * (pool.max_outcome - pool.min_outcome),
    stake: pool.min_stake,
  }),
}));
```

## Examples

- [`examples/liquidity-bot`](./examples/liquidity-bot): a minimal liquidity-bootstrapping bot for the Bitcoin streak. Reads the live BTCUSDT spot price from Binance's public REST endpoint, adds a small random jitter so concurrent bots don't all land on the same tick, and submits a min-stake prediction on every open pool.

## License

[MIT](./LICENSE)
