# bitcoin-bot

A liquidity-bootstrapping bot for the Bitcoin Flash streak. It uses `trepa.bot.run` to participate in every open pool, anchored to the stake-weighted consensus, so it lands in the winning half of accuracy distribution most rounds without chasing outsized payouts.

## Strategy: anchored consensus

For each open pool the bot:

1. Fetches the pool with its existing predictions.
2. Computes the stake-weighted mean of those predictions — a local proxy for [Crowd Signal](https://docs.trepa.app/scoring/crowd-signal).
3. Blends that consensus toward the midpoint of the outcome range, with weight proportional to how much stake is already committed (empty pool → pure midpoint; thick pool → mostly consensus).
4. Adds a small anti-stacking jitter so it doesn't sit on another player's exact value — the [accuracy-weight curve](https://docs.trepa.app/payouts/accuracy-weight) is steep (γ=6), so even small separation matters.
5. Stakes `pool.min_stake` — breadth over depth, the honest shape of a liquidity bootstrap.

Tune `JITTER_FRACTION` and `CONSENSUS_FULL_STAKE` at the top of `bot.strategy.ts` to match your platform's volumes.

## Files

- `bot.strategy.ts` — the whole thing: Trepa client, `SIGINT` → abort wiring, the `strategy(pool)` function, and the `trepa.bot.run` call.

## Run

Requires Node 22+ (for native TypeScript execution).

```bash
pnpm install

TREPA_API_KEY=trp_... \
TREPA_PRIVATE_KEY=... \
pnpm start
```

Set `TREPA_API_URL=https://www.api.stage.trepa.app` to point at staging instead of production.

Get keys: [API keys](https://docs.trepa.app/developers/api-keys), [private key](https://docs.trepa.app/developers/private-key).

## Customizing the strategy

The `strategy(pool)` function receives the full pool object (outcome range, step, unit, deadline, etc.) and may return:

- a `number` — predict that value with the default `stake` from `bot.run`
- `{ value, stake }` — override the stake for this pool (what the bundled liquidity strategy does)
- `null` — skip this pool

The returned `value` is snapped to `pool.step` and clamped to `[pool.min_outcome, pool.max_outcome]` automatically, and `stake` is clamped to `[pool.min_stake, pool.max_stake]`, so you can return any rough numbers and trust they'll be valid.

## Lifecycle hooks

`trepa.bot.run` accepts optional callbacks:

- `onStart({ me, streakId })` — once before the loop begins
- `onPredicted({ pool, value, stake })` — after every successful prediction
- `onPoolSkipped({ pool, reason })` — when no pool is open or `predict` returns null
- `onError(err)` — every time the loop catches an error (default logs to stderr)

Rewards from resolved pools are auto-claimed to your Trepa balance, so the bot doesn't need to claim anything itself.
