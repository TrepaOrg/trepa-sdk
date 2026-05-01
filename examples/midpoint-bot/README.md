# midpoint-bot

The smallest possible Trepa bot — one credential, no external data sources, predicts the midpoint of every open Bitcoin pool at min stake. See [`bot.strategy.ts`](./bot.strategy.ts).

## Run

Replace the placeholder `apiKey` and `privateKey` in [`bot.credentials.json`](./bot.credentials.json) with real values.

```bash
npm install
npm start
```

`Ctrl-C` stops the loop cleanly.
