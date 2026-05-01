<p align="center">
  <img src="assets/logo.png" alt="Trepa" width="140" />
</p>

<h1 align="center">@trepa/sdk</h1>

<p align="center">
  <strong>TypeScript SDK for the Trepa precision-prediction protocol — full type safety, built-in Solana signing, and a declarative interface for bot swarms.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@trepa/sdk"><img src="https://img.shields.io/npm/v/@trepa/sdk?style=flat-square&logo=npm&logoColor=white&color=CB3837" alt="npm" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-%3E%3D10.33.1-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Solana-signed%20transactions-9945FF?style=flat-square&logo=solana&logoColor=white" alt="Solana signed transactions" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

---

Trepa SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.io/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Quickstart

The SDK wraps every REST endpoint in the [API reference](https://docs.trepa.io/developers/api-endpoints) with full TypeScript types and built-in Solana transaction signing. On top of that, it exposes a declarative interface for writing bot **swarms**:

```ts
import { Trepa, formatNumber } from '@trepa/sdk';

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
  onStart: ({ me }) => `online as @${me.username}`,
  onPredicted: ({ pool, value, stake }) =>
    `${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`,
  onPoolSkipped: ({ pool, reason }) =>
    `${pool?.title ?? '(no pool open)'} — ${reason}`,
  onError: (err) => (err instanceof Error ? err.message : String(err)),
}));
```

### Anatomy

| Piece | What it is |
| --- | --- |
| `credentials` | One entry per bot you want to run in parallel. `credentials[0]` doubles as the primary identity for non-bot resource calls (e.g. `trepa.predictions.create`). |
| `bots.run(factory)` | Spawns one loop per credential and runs them concurrently. Pass a `(slot) => BotOptions` factory when bots need to know their position in the swarm, or a plain `BotOptions` object when every bot does the same thing. Resolves when every loop stops. |
| `slot` | `{ index, count }` — this bot's seat in the swarm. Use it to spread predictions across an outcome range, lay a price ladder, etc. |
| `predict(pool)` | The only required field. Called once per open pool. Return `{ value, stake }` to submit, or `null` to skip. `value` is auto-snapped to `pool.step` and clamped to `[min_outcome, max_outcome]`; `stake` is clamped to `[min_stake, max_stake]`. Throws are caught — the loop survives and `onError` fires. |
| `onStart` / `onPredicted` / `onPoolSkipped` / `onError` | Optional lifecycle hooks. Return a string to print it on the matching color-coded line (`[READY]`, `[PRED]`, `[SKIP]`, `[ERROR]`), or return nothing to stay silent. The SDK auto-prefixes each line with `[i/N]` when `count > 1`. |

### The loop

Each bot polls the streak for its open pool, calls `predict` once per **new** pool, sleeps until that pool's `prediction_end_date`, and repeats. `Ctrl-C` (or any `SIGINT`/`SIGTERM`) cleanly stops the whole swarm; pass your own `signal` on `BotOptions` to drive shutdown yourself.

## Examples

- [`examples/midpoint-bot`](./examples/midpoint-bot): the smallest possible bot — one credential from env vars, no external data sources, predicts the midpoint of every open Bitcoin pool at min stake. Start here.
- [`examples/liquidity-bot`](./examples/liquidity-bot): a coordinated bot swarm for the Bitcoin streak that quotes a volatility-sized price ladder around live BTC spot. Computes σ from 7 days of 1-minute Pyth log returns (mirroring the protocol's own calculation), waits until `prediction_end_date − 8 s` for the freshest spot, then positions each bot's slice of `±σ` around it.

## License

[MIT](./LICENSE)
