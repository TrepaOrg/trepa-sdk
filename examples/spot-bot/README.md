# spot-bot

One bot submitting the current BTC spot price (from Binance) for every open Bitcoin pool.

**Requires Docker** (and Docker Compose) to run as documented below. [Install Docker](https://docs.docker.com/get-docker/).

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

`Ctrl-C` stops the container.
