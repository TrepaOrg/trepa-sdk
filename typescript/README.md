# Trepa - TypeScript Examples

Runnable TypeScript examples for the [Trepa API](https://docs.trepa.app/developers/introduction), built on the [`@trepa/sdk`](../packages/sdk) package.

The SDK ships the typed client (generated from the OpenAPI spec), the cookie-jar middleware, the auth helpers, and the Solana signing helper. Everything you see in `src/examples/` is just thin glue calling that SDK.

## Setup

From the workspace root:

```bash
pnpm install                          # one-time install
pnpm --filter @trepa/sdk gen          # generate the SDK schema (only on spec changes)
```

Then configure the examples:

```bash
cd typescript
cp .env.example .env
# fill in TREPA_API_KEY and TREPA_PRIVATE_KEY
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
pnpm example:session
pnpm example:find-pool
pnpm example:place-prediction
# ...
pnpm example:quickstart
```

## Project layout

```
typescript/
  src/
    lib/
      env.ts            # requireEnv / optionalEnv, loads .env via dotenv.
      log.ts            # Tiny step / log helpers used by examples.
    examples/
      01-session.ts ... 09-withdraw.ts
      quickstart.ts
```

Everything Trepa-specific (typed client, cookie jar, auth helpers, signing) lives in [`@trepa/sdk`](../packages/sdk).

## Type-checking

```bash
pnpm typecheck
```

## How the cookie jar works

Trepa uses cookie-based auth (`trepa-token` for access, `trepa-refresh` for refresh). The SDK keeps an in-memory `Map`, attaches it as `Cookie` on outgoing requests, and captures `Set-Cookie` from responses. See `@trepa/sdk` README for details.
