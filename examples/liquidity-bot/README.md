# liquidity-bot

A minimal liquidity-seeding bot for the **Bitcoin** streak. See [`bot.strategy.ts`](./bot.strategy.ts) for the strategy.

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
