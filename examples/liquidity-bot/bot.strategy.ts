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

// Treat the pool midpoint as a virtual prediction with this much stake. When
// the real crowd has put down significantly more, our forecast follows them;
// when the pool is empty, we fall back to the midpoint.
const MIDPOINT_PRIOR_STAKE = 25

// Width of the random nudge applied to our final value, as a fraction of the
// pool's outcome range. Keeps anchored bots from clustering on identical ticks.
const JITTER_WIDTH = 0.005

await trepa.bot.run({
	predict: async (pool) => {
		const { predictions = [] } = await trepa.pools.get(pool.id, {
			includes: ['predictions'],
		})

		const midpoint = (pool.min_outcome + pool.max_outcome) / 2
		const range = pool.max_outcome - pool.min_outcome

		// Stake-weighted mean of the crowd, anchored to the midpoint by
		// seeding the accumulator with a virtual prior prediction.
		const { weighted, totalStake } = predictions.reduce(
			(acc, p) => ({
				weighted: acc.weighted + p.prediction * p.stake,
				totalStake: acc.totalStake + p.stake,
			}),
			{
				weighted: midpoint * MIDPOINT_PRIOR_STAKE,
				totalStake: MIDPOINT_PRIOR_STAKE,
			},
		)

		const center = weighted / totalStake
		const jitter = (Math.random() - 0.5) * JITTER_WIDTH * range

		return { value: center + jitter, stake: pool.min_stake }
	},
	onStart: ({ me }) =>
		console.log(`Liquidity bot online as @${me.username}`),
	onPredicted: ({ pool, value, stake }) =>
		console.log(`[${pool.title}] predicted ${value} with ${stake} stake`),
})
