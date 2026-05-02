# spot-bot

The smallest possible Trepa bot: one credential, predicts the current BTC spot price (fetched from Binance) for every open Bitcoin pool at min stake. See [`bot.strategy.ts`](./bot.strategy.ts).

## Run

```bash
# in this directory, copy the env template and fill in your credentials
cp .env.example .env
$EDITOR .env

# install and start
npm install
npm start
```

`npm start` runs `node --env-file=.env bot.strategy.ts`, so `.env` is loaded by Node directly (no `dotenv` dependency).

`Ctrl-C` stops the loop cleanly.
