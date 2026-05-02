# spot-bot

The smallest possible Trepa bot: one credential, predicts the current BTC spot
price (from Binance) for every open Bitcoin pool at **min stake**.

Required environment variables: `TREPA_API_KEY`, `TREPA_PRIVATE_KEY` (see
[`.env.example`](./.env.example) for the shape—only a template, not loaded
automatically).

## Run with Docker

```bash
export TREPA_API_KEY=…
export TREPA_PRIVATE_KEY=…
docker compose up --build
```

`Ctrl-C` stops the container.

## Run with Node

Requires Node **≥ 22.12**.

```bash
npm ci
export TREPA_API_KEY=…
export TREPA_PRIVATE_KEY=…
npm start
```

Optional: `node --env-file=./.env bot.strategy.ts` if you keep secrets in a
file locally.

## Image only

```bash
docker build -t trepa/example-spot-bot .
```
