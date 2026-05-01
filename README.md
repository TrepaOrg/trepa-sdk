# Trepa Examples

Runnable example code for integrating with the [Trepa API](https://docs.trepa.app/developers/introduction).

Each example mirrors a flow from the docs - get a session, find the live Flash Pool, place a prediction, claim a streak reward, withdraw - and is meant to be copy-pasted into your own bot or script.

## Languages

| Language   | Status      | Folder                        |
| ---------- | ----------- | ----------------------------- |
| TypeScript | Available   | [`typescript/`](./typescript) |
| Python     | Coming soon | -                             |
| Go         | Coming soon | -                             |

Have a favourite language we have not covered yet? Open an issue or PR. The examples follow the same numbered structure across languages so they are easy to port.

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

Every state-changing endpoint follows the same `create -> sign -> submit` pattern, so once one example clicks the rest fall into place.

## Typed client from the OpenAPI spec

The TypeScript examples use a tiny client generated from the published [OpenAPI spec](https://docs.trepa.app/openapi.json), so request/response shapes stay in sync with the live API. See [`typescript/README.md`](./typescript/README.md) for how to regenerate it.

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
