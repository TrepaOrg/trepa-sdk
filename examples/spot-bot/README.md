# spot-bot

The smallest possible Trepa bot; one credential, predicts the current BTC spot price (fetched from Binance) for every open Bitcoin pool at min stake. See [`bot.strategy.ts`](./bot.strategy.ts).

## Run

This example links to the local SDK (`@trepa/sdk: file:../..`), so build the SDK once at the repo root before installing here.

Replace the placeholder `apiKey` and `privateKey` in [`bot.credentials.json`](./bot.credentials.json) with real values.

```bash
# from the trepa-sdk repo root, once
pnpm install && pnpm build

# then in this directory
npm install
npm start
```

`Ctrl-C` stops the loop cleanly.
