# liquidity-bot

A liquidity-bootstrapping bot for the Bitcoin Flash streak. It uses `trepa.bot.run` to participate in every open pool, anchored to the stake-weighted consensus, so it lands in the winning half of the accuracy distribution most rounds without chasing outsized payouts.

## Run

Requires Node 22+ (for native TypeScript execution).

```bash
npm install
cp .env.example .env   # then fill in TREPA_API_KEY and TREPA_PRIVATE_KEY
npm start
```

Get keys: [API keys](https://docs.trepa.io/developers/api-keys), [private key](https://docs.trepa.io/developers/private-key).

## Strategy: anchored consensus

For each open pool the bot:

1. Fetches the pool with its existing predictions.
2. Computes the stake-weighted mean of those predictions — a local proxy for [Crowd Signal](https://docs.trepa.io/scoring/crowd-signal).
3. Blends that consensus toward the midpoint of the outcome range, with weight proportional to how much stake is already committed (empty pool → pure midpoint; thick pool → mostly consensus).
4. Adds a small anti-stacking jitter so it doesn't sit on another player's exact value — the [accuracy-weight curve](https://docs.trepa.io/payouts/accuracy-weight) is steep (γ=6), so even small separation matters.
5. Stakes `pool.min_stake` — breadth over depth, the honest shape of a liquidity bootstrap.

Tune `JITTER_FRACTION` and `CONSENSUS_FULL_STAKE` at the top of `bot.strategy.ts` to match your platform's volumes.

## Customizing the strategy

The `predict(pool)` callback may return:

- a `number` — predict that value with the default `stake` from `bot.run`
- `{ value, stake }` — override the stake for this pool (what the bundled liquidity strategy does)
- `null` — skip this pool

Returned `value` is snapped to `pool.step` and clamped to `[pool.min_outcome, pool.max_outcome]` automatically; `stake` is clamped to `[pool.min_stake, pool.max_stake]`.
