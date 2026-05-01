# @trepa/sdk

Typed TypeScript SDK for the [Trepa API](https://docs.trepa.app/developers/introduction).

The SDK is generated from the [public OpenAPI spec](https://docs.trepa.app/openapi.json), so request and response shapes always match the live API. On top of the generated types it ships:

- A cookie-jar-aware client that handles Trepa's `trepa-token` / `trepa-refresh` session cookies for you in any Node 20+ environment (no browser needed).
- `startSession` / `refreshSession` / `endSession` helpers built around `/auth/session`, `/auth/refresh`, `/auth/logout`.
- A `signTransaction` helper that decodes the base64 `VersionedTransaction` returned by every transaction endpoint, signs it with your embedded wallet key, and re-encodes it for submission.

For end-to-end runnable examples, see [`TrepaOrg/examples`](https://github.com/TrepaOrg/examples).

## Install

```bash
pnpm add @trepa/sdk @solana/web3.js
# or
npm install @trepa/sdk @solana/web3.js
# or
yarn add @trepa/sdk @solana/web3.js
```

`@solana/web3.js` is a peer dependency so the SDK doesn't pin a version that conflicts with yours.

## Quickstart

```ts
import {
	createTrepaClient,
	startSession,
	signTransaction,
	unwrap,
} from '@trepa/sdk'

const trepa = createTrepaClient()

await startSession(trepa, process.env.TREPA_API_KEY!)

// Find the live Bitcoin Flash Pool
const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
const details = unwrap(
	await trepa.client.GET('/streak/pool-details', {
		params: { query: { streak_id: streak.id } },
	}),
)
const pool = details.current_pool
if (!pool) throw new Error('No Bitcoin pool open right now.')

// Create -> sign -> submit
const created = unwrap(
	await trepa.client.POST('/transactions/prediction', {
		body: { pool_id: pool.id, stake: 1, value: 50_000 },
	}),
)
const signedTransaction = signTransaction(
	created.transaction,
	process.env.TREPA_PRIVATE_KEY!,
)
const submitted = unwrap(
	await trepa.client.POST('/transactions/prediction/submit', {
		body: {
			pool_id: pool.id,
			signed_transaction: signedTransaction,
			proof: created.proof,
		},
	}),
)

console.log('Submitted:', submitted.signature)
```

The same `create -> sign -> submit` pattern applies to every state-changing endpoint (predictions, stake updates, claim-reward, claim-streak-reward, withdraw).

## API

### `createTrepaClient(options?)`

Builds a typed Trepa client and an in-memory cookie jar.

```ts
import { createTrepaClient } from '@trepa/sdk'

const trepa = createTrepaClient({
	baseUrl: 'https://www.api.trepa.app', // optional, this is the default
	jar: undefined,                       // optional, pass your own to share/persist
})

// `trepa.client` is a fully typed openapi-fetch client
trepa.client.GET('/auth/me')
```

Returned object:

| Field     | Type                | Notes                                                  |
| --------- | ------------------- | ------------------------------------------------------ |
| `client`  | `Client<paths>`     | Typed `openapi-fetch` client.                           |
| `jar`     | `Map<string,string>`| Cookie jar (`trepa-token`, `trepa-refresh`).            |
| `baseUrl` | `string`            | Base URL the client is bound to.                        |

### `startSession(trepa, apiKey)` / `refreshSession(trepa)` / `endSession(trepa)`

Thin wrappers around `/auth/session`, `/auth/refresh`, and `/auth/logout` that update the cookie jar in place.

### `signTransaction(base64Transaction, privateKeyBase58)`

Decodes the base64 `VersionedTransaction` returned by any Trepa `create` endpoint, signs it with the supplied embedded-wallet key, and returns the signed transaction encoded as base64 ready for the matching `submit` endpoint.

### `unwrap(result)`

Convenience helper that throws on `result.error` and returns `result.data`. Use it when you don't need to handle the error inline.

### Types

Both the high-level types (`TrepaClient`, `CookieJar`, `TrepaClientOptions`) and the raw OpenAPI types (`paths`, `components`, `operations`) are re-exported. The raw types are also available at the `@trepa/sdk/schema` subpath if you want to import only the schema:

```ts
import type { components, paths } from '@trepa/sdk/schema'

type Pool = components['schemas']['PoolWithRelationsDto']
```

## Cookie handling

Trepa uses cookie-based auth: `POST /auth/session` returns `trepa-token` (access) and `trepa-refresh`, and every later request must replay them. Browsers do this automatically; Node's global `fetch` does not. `createTrepaClient` registers two `openapi-fetch` middlewares:

- `onRequest` — attaches `Cookie: <jar>` if the jar is non-empty.
- `onResponse` — captures `Set-Cookie` from the response into the jar.

That's it. You can pass your own `Map<string, string>` if you need to share or persist a session.

## Regenerating the schema

The repository ships a snapshot of the OpenAPI spec at `packages/sdk/openapi.json`. To regenerate:

```bash
pnpm --filter @trepa/sdk gen          # from local snapshot
pnpm --filter @trepa/sdk gen:remote   # from https://docs.trepa.app/openapi.json
```

`gen:remote` pulls the latest published spec; bump the snapshot by replacing `openapi.json` and rerunning `pnpm gen`.

## License

[MIT](./LICENSE)
