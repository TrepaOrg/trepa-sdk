# liquidity-bot

A bot swarm that quotes a volatility-sized ladder around BTC spot. Three credentials, each takes a slice of `±σ` around live BTC spot. See [`bot.strategy.ts`](./bot.strategy.ts) for the strategy.

## Run

```bash
# in this directory, copy the env template and fill in your three credentials
cp .env.example .env
$EDITOR .env

# install and start
npm install
npm start
```

`npm start` runs `node --env-file=.env bot.strategy.ts`, so `.env` is loaded by Node directly (no `dotenv` dependency). The SDK's `credentialsFromEnv()` picks up `TREPA_API_KEY_1` / `TREPA_PRIVATE_KEY_1`, `_2`, `_3` automatically.

`Ctrl-C` stops the swarm cleanly.
