# @trepa/sdk

Typed TypeScript SDK for the [Trepa API](https://docs.trepa.app/developers/introduction).

## Install

```bash
npm install @trepa/sdk @solana/kit
```

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
const signed = await signTransaction(created.transaction, process.env.TREPA_PRIVATE_KEY!)
await trepa.client.POST('/transactions/prediction/submit', {
	body: { pool_id: current_pool.id, signed_transaction: signed, proof: created.proof },
})
```

For the full set of endpoints and walkthroughs, visit the [docs](https://docs.trepa.app/developers/introduction).

## License

[MIT](./LICENSE)
