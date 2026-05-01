# Trepa - TypeScript Examples

Typed TypeScript examples for the [Trepa API](https://docs.trepa.app/developers/introduction). Built on a tiny client generated from the [OpenAPI spec](https://docs.trepa.app/openapi.json), so request and response shapes always match the live API.

## Stack

- [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) - generates `paths` and `components` types from the OpenAPI spec.
- [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) - tiny typed `fetch` wrapper that consumes those types.
- [`@solana/web3.js`](https://solana-labs.github.io/solana-web3.js/) + [`bs58`](https://www.npmjs.com/package/bs58) - decode, sign, and re-encode the `VersionedTransaction` returned by every transaction endpoint.
- [`tsx`](https://tsx.is/) - run the examples without a build step.
- [`dotenv`](https://www.npmjs.com/package/dotenv) - loads your secrets from `.env`.

The whole project type-checks, including the body and query shapes for every endpoint.

## Setup

```bash
# 1. install
pnpm install

# 2. configure
cp .env.example .env
# then edit .env and fill in TREPA_API_KEY and TREPA_PRIVATE_KEY
```

You will need:

- A `TREPA_API_KEY` (`Settings -> API keys` in the Trepa app, see [API Keys](https://docs.trepa.app/developers/api-keys)).
- A `TREPA_PRIVATE_KEY` for your embedded wallet (`Settings -> Embedded Wallet -> Export`, see [Wallet private key](https://docs.trepa.app/developers/private-key)).

Treat both as secrets. Never commit `.env`.

## Running examples

Each script is self-contained and runnable via a `pnpm example:*` shortcut.

| Script                                                                  | What it does                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`01-session.ts`](./src/examples/01-session.ts)                         | Open, refresh, and close a session.                            |
| [`02-find-pool.ts`](./src/examples/02-find-pool.ts)                     | Find the live Flash Pool of the Bitcoin streak.                |
| [`03-place-prediction.ts`](./src/examples/03-place-prediction.ts)       | Place a prediction (create -> sign -> submit).                 |
| [`04-update-prediction.ts`](./src/examples/04-update-prediction.ts)     | Update a prediction's value.                                   |
| [`05-update-stake.ts`](./src/examples/05-update-stake.ts)               | Update a prediction's stake.                                   |
| [`06-streak-progress.ts`](./src/examples/06-streak-progress.ts)         | Read your streak progress and unclaimed rewards.               |
| [`07-claim-streak-reward.ts`](./src/examples/07-claim-streak-reward.ts) | Claim a streak reward.                                         |
| [`08-claim-pool-reward.ts`](./src/examples/08-claim-pool-reward.ts)     | Claim a per-pool prize reward.                                 |
| [`09-withdraw.ts`](./src/examples/09-withdraw.ts)                       | Withdraw funds to an external Solana wallet.                   |
| [`quickstart.ts`](./src/examples/quickstart.ts)                         | The full Quickstart loop end-to-end.                           |

```bash
# Run any example
pnpm example:session
pnpm example:find-pool
pnpm example:place-prediction
# ...

# Or run the end-to-end quickstart
pnpm example:quickstart
```

## Project layout

```
typescript/
  openapi.json              # Snapshot of the spec used for codegen.
  src/
    api/
      schema.ts             # Generated. Do not edit by hand.
    lib/
      client.ts             # Cookie-jar-aware Trepa client (built on openapi-fetch).
      auth.ts               # startSession / refreshSession / endSession helpers.
      sign.ts               # Sign a base64 VersionedTransaction with a bs58 key.
      env.ts                # requireEnv / optionalEnv.
      log.ts                # Tiny step / log helpers used by examples.
    examples/
      01-session.ts ... 09-withdraw.ts
      quickstart.ts
```

## Regenerating the client

Whenever the API spec changes, regenerate the typed schema:

```bash
# Use the snapshot in this repo (good for reproducible builds)
pnpm gen

# Or pull straight from the public docs site
pnpm gen:remote
```

`pnpm gen` writes `src/api/schema.ts` from `./openapi.json`. To bump the snapshot itself, replace `openapi.json` with the latest copy from [docs.trepa.app/openapi.json](https://docs.trepa.app/openapi.json) and rerun `pnpm gen`.

## Type-checking

```bash
pnpm typecheck
```

## How the cookie jar works

Trepa uses cookie-based auth (`trepa-token` for access, `trepa-refresh` for refresh). Browsers handle this automatically; Node's global `fetch` does not. The Trepa client in `lib/client.ts` keeps an in-memory `Map` and:

- attaches a `Cookie` header to every outgoing request via an `onRequest` middleware.
- captures `Set-Cookie` from every response via an `onResponse` middleware.

That's all there is to it - the rest of the code is cookie-agnostic.
