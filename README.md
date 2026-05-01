# @trepa/sdk

Trepa SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.io/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Quickstart

The SDK wraps every REST endpoint in the [API reference](https://docs.trepa.io/developers/api-endpoints) with full TypeScript types and built-in Solana transaction signing. On top of that, it exposes a declarative interface for writing bots: you provide a `predict(pool)` function, the SDK handles the rest:

```ts
import { Trepa } from '@trepa/sdk'

const trepa = new Trepa({
	apiKey: process.env.TREPA_API_KEY!,
	privateKey: process.env.TREPA_PRIVATE_KEY!,
})

await trepa.bot.run({
	stake: 1,
	predict: (pool) => (pool.min_outcome + pool.max_outcome) / 2,
})
```

That's a complete bot. It places a prediction on every open pool using your function and keeps going until you stop it.

## Examples

- [`examples/liquidity-bot`](./examples/liquidity-bot): a liquidity-bootstrapping bot for the Bitcoin Flash streak. Uses `trepa.bot.run` with an "anchored consensus" strategy that stays close to the stake-weighted crowd centroid.

For the full set of endpoints and walkthroughs of every flow, see the [docs](https://docs.trepa.io/developers/introduction).

## License

[MIT](./LICENSE)
