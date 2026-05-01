# @trepa/sdk

Typed TypeScript SDK for the [Trepa API](https://docs.trepa.app/developers/introduction). Generated from the OpenAPI spec, with cookie-based session handling and Solana transaction signing built in.

## Install

```bash
npm install @trepa/sdk @solana/web3.js
```

`@solana/web3.js` is a peer dependency. Requires Node 20+.

## Usage

```ts
import { createTrepaClient, startSession, signTransaction, unwrap } from '@trepa/sdk'

const trepa = createTrepaClient()

await startSession(trepa, process.env.TREPA_API_KEY!)

const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
const { current_pool } = unwrap(
	await trepa.client.GET('/streak/pool-details', {
		params: { query: { streak_id: streak.id } },
	}),
)
if (!current_pool) throw new Error('No Bitcoin pool open right now.')

const created = unwrap(
	await trepa.client.POST('/transactions/prediction', {
		body: { pool_id: current_pool.id, stake: 1, value: 50_000 },
	}),
)
const signed = signTransaction(created.transaction, process.env.TREPA_PRIVATE_KEY!)
const { signature } = unwrap(
	await trepa.client.POST('/transactions/prediction/submit', {
		body: { pool_id: current_pool.id, signed_transaction: signed, proof: created.proof },
	}),
)
```

The same `create -> sign -> submit` pattern applies to every state-changing endpoint. End-to-end runnable scripts for each flow are in [`examples/`](./examples).

## API

| Export                                          | What it does                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `createTrepaClient({ baseUrl?, jar? })`         | Returns `{ client, jar, baseUrl }`. `client` is a fully typed [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) client. |
| `startSession(trepa, apiKey)`                   | Exchanges an API key for `trepa-token` / `trepa-refresh` cookies.                                              |
| `refreshSession(trepa)`                         | Refreshes an expired access token.                                                                             |
| `endSession(trepa)`                             | Logs out and clears the cookie jar.                                                                            |
| `signTransaction(base64Tx, privateKeyBase58)`   | Decodes, signs, and re-encodes the `VersionedTransaction` returned by any `/transactions/*` create endpoint.   |
| `unwrap(result)`                                | Throws on `result.error`, returns `result.data`.                                                               |

The raw OpenAPI types are also re-exported (`paths`, `components`, `operations`), or available via the dedicated subpath:

```ts
import type { components } from '@trepa/sdk/schema'

type Pool = components['schemas']['PoolWithRelationsDto']
```

## Auth

`startSession` returns nothing — it captures the session cookies into an in-memory jar that subsequent calls replay automatically. If you need to share or persist a session across processes, pass your own `jar: new Map()` to `createTrepaClient` and serialise it yourself.

When the API rejects a call with `403` (or `401` on `/auth/*`), call `refreshSession(trepa)` and retry.

## Links

- [Quickstart guide](https://docs.trepa.app/developers/quickstart)
- [API Reference](https://docs.trepa.app/api-reference)
- [Examples](./examples)
- [Issues](https://github.com/TrepaOrg/trepa-sdk/issues)

## License

[MIT](./LICENSE)
