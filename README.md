# Trepa Examples

Runnable example code and a publishable SDK for integrating with the [Trepa API](https://docs.trepa.app/developers/introduction).

## Layout

This repository is a [pnpm workspace](https://pnpm.io/workspaces):

```
.
├── packages/
│   └── sdk/                  # @trepa/sdk - the publishable typed SDK
└── typescript/               # Runnable TypeScript examples on top of @trepa/sdk
```

| Path                                       | Purpose                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [`packages/sdk`](./packages/sdk)           | `@trepa/sdk` - typed Trepa client generated from the OpenAPI spec, plus cookie / signing helpers. |
| [`typescript`](./typescript)               | Runnable TypeScript examples mirroring the docs Quickstart, built on `@trepa/sdk`.             |

## Languages

| Language   | Status      | Folder                        |
| ---------- | ----------- | ----------------------------- |
| TypeScript | Available   | [`typescript/`](./typescript) |
| Python     | Coming soon | -                             |
| Go         | Coming soon | -                             |

When adding a language, mirror the numbered structure (`01-session`, `02-find-pool`, ...) so flows stay easy to compare.

## What is covered

The examples walk through the same end-to-end loop documented in the [Quickstart](https://docs.trepa.app/developers/quickstart):

1. Exchange your API key for a session.
2. Find the current Flash Pool of a streak (e.g. Bitcoin).
3. Create, sign, and submit a prediction transaction.
4. Update a prediction's value or stake.
5. Check your streak progress.
6. Claim a streak reward when you have earned one.
7. Claim per-pool prize rewards.
8. Withdraw funds.

Every state-changing endpoint follows the same `create -> sign -> submit` pattern.

## Working in the workspace

```bash
# install everything
pnpm install

# regenerate the SDK schema from the snapshot at packages/sdk/openapi.json
pnpm gen

# build @trepa/sdk -> dist/
pnpm build

# typecheck every package
pnpm typecheck
```

Run an example (after copying `typescript/.env.example` to `typescript/.env`):

```bash
pnpm --filter @trepa/examples-typescript example:quickstart
```

## Publishing @trepa/sdk

```bash
# bump version (semantic)
pnpm --filter @trepa/sdk version <patch|minor|major>

# clean build + publish
pnpm --filter @trepa/sdk publish
```

`prepublishOnly` regenerates the schema and rebuilds before publishing. The published artefact only ships `dist/`, the README, and the LICENSE - source and OpenAPI snapshot stay in the repo.

## Before you start

You will need:

- A Trepa account - sign up at [trepa.app](https://www.trepa.app).
- An API key from `Settings -> API keys` - see [API Keys](https://docs.trepa.app/developers/api-keys).
- Your embedded wallet's private key, exported from the app - see [Wallet private key](https://docs.trepa.app/developers/private-key).

Treat the API key and private key as secrets. Never commit them or expose them in client-side code.

## Reporting issues

Found a bug, an outdated example, or want a missing flow added? [Open an issue](https://github.com/TrepaOrg/examples/issues/new). PRs welcome.

## License

[MIT](./LICENSE)
