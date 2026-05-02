# spot-bot

The smallest possible Trepa bot: one credential, predicts the current BTC spot
price (from Binance) for every open Bitcoin pool at **min stake**.

**Requires Docker** (and Docker Compose) to run as documented below. [Install Docker](https://docs.docker.com/get-docker/).

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

`Ctrl-C` stops the container.
