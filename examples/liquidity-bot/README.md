# liquidity-bot

A **swarm** of bots that quote a **Gaussian-spaced** ladder around live BTC spot:
each slot sits at a quantile of `N(0, σ²)` (with σ scaled from historical
volatility and the pool’s resolution horizon), so more bots sit near the
median and fewer in the tails. See [`bot.strategy.ts`](./bot.strategy.ts).

On a **30s** prediction window, initial quotes land in **three mixed salvos**
by **second 10**; every bot reprices together **10s before close** (second 20).

**Requires Docker** (and Docker Compose) to run as documented below. [Install Docker](https://docs.docker.com/get-docker/).

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

`Ctrl-C` stops the container.
