/**
 * 06 - Check your streak progress.
 *
 * After a Flash Pool settles, your prediction may have moved your streak
 * forward. `GET /streak/user-details` returns your `current_streak_count`,
 * `last_streak_event` (NONE / QUALIFIED / RESET / REWARDED), and any
 * outstanding streak rewards.
 *
 *   $ pnpm example:streak-progress
 */

import { startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Resolving the Bitcoin streak')
	const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))

	step('Fetching your unclaimed streak rewards')
	const details = unwrap(
		await trepa.client.GET('/streak/user-details', {
			params: { query: { streak_id: streak.id, is_claimed: false } },
		}),
	)

	log('Progress', {
		streak_count_required: streak.streak_count_required,
		current_streak_count: details.current_streak_count,
		last_streak_event: details.last_streak_event,
	})

	const rewards = details.streak_rewards ?? []
	if (rewards.length === 0) {
		log('No unclaimed rewards yet', null)
		return
	}

	log(
		'Unclaimed rewards',
		rewards.map((r) => ({ id: r.id, amount: r.amount })),
	)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
