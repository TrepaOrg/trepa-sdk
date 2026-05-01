# liquidity-bot

A bot swarm that quotes a volatility-sized ladder around BTC spot. See [`bot.strategy.ts`](./bot.strategy.ts) for the strategy.

## Run

Replace the placeholder `apiKey` and `privateKey` in [`bot.credentials.json`](./bot.credentials.json) with real values.

```bash
npm install
npm start
```

`Ctrl-C` stops the loop cleanly.
