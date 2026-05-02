# liquidity-bot

A **swarm** of bots that quote a **Gaussian-spaced** ladder around live BTC spot:
each slot sits at a quantile of `N(0, σ²)` (with σ scaled from historical
volatility and the pool’s resolution horizon), so more bots sit near the
median and fewer in the tails. See [`bot.strategy.ts`](./bot.strategy.ts).

[`bot.manager.ts`](./bot.manager.ts) exports **`withManager(trepa, credentials, main)`** next to an optional **master-wallet USDC funder** when `TREPA_MASTER_PRIVATE_KEY` is set in `.env`.

## Run

```bash
# in this directory, copy the env template and fill in your credentials
cp .env.example .env
$EDITOR .env

# install and start
npm install
npm start
```

`npm start` runs `node --env-file=.env bot.strategy.ts`, so `.env` is loaded by Node directly (no `dotenv` dependency).

`Ctrl-C` stops the loop cleanly.
