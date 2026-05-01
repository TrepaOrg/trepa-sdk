# liquidity-bot

A bot swarm that quotes a volatility-sized ladder around BTC spot. See [`bot.strategy.ts`](./bot.strategy.ts) for the strategy.

## Run

Replace the placeholder `apiKey` and `privateKey` for each bot in [`bots.credentials.json`](./bots.credentials.json) with real values; one entry per bot, the swarm size matches the array length.

```bash
npm install
npm start
```

`Ctrl-C` stops every bot in the swarm cleanly.
