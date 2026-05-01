# @trepa/sdk

TREPA-SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.app/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Usage

```ts
import { Trepa } from '@trepa/sdk'

const trepa = new Trepa({
	apiKey: process.env.TREPA_API_KEY!,
	privateKey: process.env.TREPA_PRIVATE_KEY!,
})

// 1. Confirm the session is live.
const me = await trepa.me()

// 2. Find the open Bitcoin Flash pool.
const streak = await trepa.streaks.bitcoin()

const { current_pool: pool } = await trepa.streaks.poolDetails(streak.id)

if (!pool) throw new Error('No Bitcoin pool open right now.')

// 3. Place a prediction.
await trepa.predictions.create({
	poolId: pool.id,
	stake: 1,
	value: 50_000,
})

// 6. End the session when you're done.
await trepa.logout()
```

For the full set of endpoints and walkthroughs of every flow, see the [docs](https://docs.trepa.app/developers/introduction).

## License

[MIT](./LICENSE)
