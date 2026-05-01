# liquidity-bot

A minimal liquidity-seeding bot for the **Bitcoin** streak. Predicts the live BTCUSDT spot price (with a tiny random jitter) at min stake on every open pool. See [`bot.strategy.ts`](./bot.strategy.ts) for the strategy.

## Run

```bash
cp .env.example .env   # fill in TREPA_API_KEY and TREPA_PRIVATE_KEY
npm install
npm start
```

Requires Node 22.12+. `Ctrl-C` stops the bot cleanly.

## Configure

- `TREPA_API_KEY` — get one at [docs.trepa.io/developers/api-keys](https://docs.trepa.io/developers/api-keys)
- `TREPA_PRIVATE_KEY` — Solana key that funds predictions, see [docs.trepa.io/developers/private-key](https://docs.trepa.io/developers/private-key)

## Customize

Edit `predict` in `bot.strategy.ts` to change what value or stake the bot submits. Any function returning `{ value, stake }` (or just a `number`) works — the SDK handles polling, dedup, and snapping to pool steps for you.
