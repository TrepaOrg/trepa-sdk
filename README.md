# @trepa/sdk

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

- [`examples/liquidity-bot`](./examples/liquidity-bot): a coordinated bot swarm for the Bitcoin streak that quotes a volatility-sized price ladder around live BTC spot. Computes σ from 7 days of 1-minute Pyth log returns (mirroring the protocol's own calculation), waits until `prediction_end_date − 8 s` for the freshest spot, then positions each bot's slice of `±σ` around it.

## License

[MIT](./LICENSE)
