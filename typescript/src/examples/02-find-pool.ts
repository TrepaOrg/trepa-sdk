/**
 * 02 - Find the live Flash Pool of a streak.
 *
 * Flash Pools belong to a streak. To know which pool is currently open for
 * predictions, ask the streak for its pool details: `current_pool` is the
 * one accepting predictions, `next_pool` is the one queued up after it.
 *
 *   $ pnpm example:find-pool
 */

import { createTrepaClient, startSession, unwrap } from '@trepa/sdk'

import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Looking up the Bitcoin streak')
	const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
	log('Streak', streak)

	step(`Asking the streak for its current and next pool`)
	const details = unwrap(
		await trepa.client.GET('/streak/pool-details', {
			params: { query: { streak_id: streak.id } },
		}),
	)

	if (!details.current_pool) {
		log('No pool open right now', details)
		return
	}

	log('Current pool', {
		id: details.current_pool.id,
		title: details.current_pool.title,
		unit: details.current_pool.unit,
		min_stake: details.current_pool.min_stake,
		max_stake: details.current_pool.max_stake,
	})

	if (details.next_pool) {
		log('Next pool', {
			id: details.next_pool.id,
			title: details.next_pool.title,
		})
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
