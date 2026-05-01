import { Trepa } from '@trepa/sdk'

const trepa = new Trepa({
	baseUrl: process.env.TREPA_API_URL,
	apiKey: process.env.TREPA_API_KEY,
	privateKey: process.env.TREPA_PRIVATE_KEY,
})

// --- Liquidity bootstrap strategy ------------------------------------------
//
// Goal: put volume on every open pool while staying close to the consensus,
// so we land below the median error roughly half the time (winners) and
// occasionally collect a small accuracy-weight bonus when the crowd is right.
// We will never win the jackpot — that's the point. Liquidity providers
// trade outsized upside for steady participation.

const JITTER_FRACTION = 0.005
const CONSENSUS_FULL_STAKE = 25

await trepa.bot.run({
	predict: async (pool) => {
		const { predictions = [] } = await trepa.pools.get(pool.id, {
			includes: ['predictions'],
		})

		const midpoint = (pool.min_outcome + pool.max_outcome) / 2
		const totalStake = predictions.reduce((s, p) => s + p.stake, 0)

		let center = midpoint
		let confidence = 0
		if (totalStake > 0) {
			const weighted = predictions.reduce(
				(s, p) => s + p.prediction * p.stake,
				0,
			)
			center = weighted / totalStake
			confidence = Math.min(1, totalStake / CONSENSUS_FULL_STAKE)
		}

		const blended = center * confidence + midpoint * (1 - confidence)
		const jitter =
			(Math.random() - 0.5) *
			JITTER_FRACTION *
			(pool.max_outcome - pool.min_outcome)

		return { value: blended + jitter, stake: pool.min_stake }
	},
	onStart: ({ me }) =>
		console.log(`Liquidity bot online as @${me.username}`),
	onPredicted: ({ pool, value, stake }) =>
		console.log(`[${pool.title}] predicted ${value} with ${stake} stake`),
})
