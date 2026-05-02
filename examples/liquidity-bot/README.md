# liquidity-bot

A **swarm** of bots that quote a **Gaussian-spaced** ladder around live BTC spot:
each slot sits at a quantile of `N(0, σ²)` (with σ scaled from historical
volatility and the pool’s resolution horizon), so more bots sit near the
median and fewer in the tails. See [`bot.strategy.ts`](./bot.strategy.ts).

[`bot.manager.ts`](./bot.manager.ts) exports **`withManager(trepa, credentials, main)`** next to an optional **master-wallet USDC funder** when `TREPA_MASTER_PRIVATE_KEY` is set in the environment.

Swarm variables: see [`.env.example`](./.env.example) (template only; nothing
loads it unless you wire that yourself).

## Run with Docker

```bash
export TREPA_API_KEY_1=… TREPA_PRIVATE_KEY_1=…
# …_2 / _3 as needed; optional TREPA_MASTER_PRIVATE_KEY
docker compose up --build
```

`Ctrl-C` stops the container.

## Run with Node

Requires Node **≥ 22.12**.

```bash
npm ci
export TREPA_API_KEY_1=… TREPA_PRIVATE_KEY_1=…
npm start
```

Optional: `node --env-file=./.env bot.strategy.ts` for a local secrets file.

## Image only

```bash
docker build -t trepa/example-liquidity-bot .
```
