# spot-bot

The smallest possible Trepa bot: one credential, predicts the current BTC spot price (fetched from Binance) for every open Bitcoin pool at min stake. See [`bot.strategy.ts`](./bot.strategy.ts).

## Run

This example links to the local SDK (`@trepa/sdk: file:../..`), so build the SDK once at the repo root before installing here.

```bash
# from the trepa-sdk repo root, once
pnpm install && pnpm build

# in this directory, copy the env template and fill in your credentials
cp .env.example .env
$EDITOR .env

# install and start
npm install
npm start
```

`npm start` runs `node --env-file=.env bot.strategy.ts`, so `.env` is loaded by Node directly (no `dotenv` dependency).

`Ctrl-C` stops the loop cleanly.
