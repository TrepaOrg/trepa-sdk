# liquidity-bot

A **swarm** of bots that quote a **Gaussian-spaced** ladder around live BTC spot:
each slot sits at a quantile of `N(0, σ²)` (with σ scaled from historical
volatility and the pool’s resolution horizon), so more bots sit near the
median and fewer in the tails. See [`bot.strategy.ts`](./bot.strategy.ts).

**Requires Docker** (and Docker Compose) to run as documented below. [Install Docker](https://docs.docker.com/get-docker/).

## Run with Docker

```bash
export TREPA_MASTER_PRIVATE_KEY=...
export TREPA_API_KEY_1=... 
export TREPA_PRIVATE_KEY_1=...

docker compose up --build
```

`Ctrl-C` stops the container.
