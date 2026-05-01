/**
 * quickstart - End-to-end loop on the Bitcoin Flash Pool.
 *
 * Mirrors the docs Quickstart 1:1, in one runnable script.
 *
 *   1. Open a session.
 *   2. Find the live Bitcoin pool.
 *   3. Place a prediction.
 *   4. Check streak progress.
 *   5. (Best effort) claim a streak reward if one is unclaimed.
 *   6. Log out.
 *
 * Predictions only land while the pool is open; if no Bitcoin pool is
 * currently live the script prints a heads-up and exits cleanly.
 *
 *   $ pnpm example:quickstart
 */

import { endSession, startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'
import { signTransaction } from '../lib/sign.ts'

const STAKE = 1
const VALUE = 50_000

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const privateKey = requireEnv('TREPA_PRIVATE_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })

	step('1. Open session')
	await startSession(trepa, apiKey)

	step('2. Find the current Bitcoin pool')
	const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
	const details = unwrap(
		await trepa.client.GET('/streak/pool-details', {
			params: { query: { streak_id: streak.id } },
		}),
	)
	if (!details.current_pool) {
		log('No Bitcoin pool open right now', null)
		await endSession(trepa)
		return
	}
	const poolId = details.current_pool.id
	log('Live pool', { id: poolId, title: details.current_pool.title })

	step('3. Place a prediction (create -> sign -> submit)')
	const created = unwrap(
		await trepa.client.POST('/transactions/prediction', {
			body: { pool_id: poolId, stake: STAKE, value: VALUE },
		}),
	)
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/prediction/submit', {
			body: {
				pool_id: poolId,
				signed_transaction: signedTransaction,
				proof: created.proof,
			},
		}),
	)
	log('Prediction submitted', submitted)

	step('4. Check streak progress')
	const userDetails = unwrap(
		await trepa.client.GET('/streak/user-details', {
			params: { query: { streak_id: streak.id, is_claimed: false } },
		}),
	)
	log('Progress', {
		current_streak_count: userDetails.current_streak_count,
		last_streak_event: userDetails.last_streak_event,
		unclaimed_rewards: (userDetails.streak_rewards ?? []).length,
	})

	const reward = (userDetails.streak_rewards ?? [])[0]
	if (reward) {
		step('5. Claim outstanding streak reward')
		const claim = unwrap(
			await trepa.client.POST('/transactions/claim-streak-reward', {
				body: { streak_reward_id: reward.id },
			}),
		)
		const signedClaim = signTransaction(claim.transaction, privateKey)
		const claimed = unwrap(
			await trepa.client.POST(
				'/transactions/claim-streak-reward/submit',
				{
					body: {
						streak_reward_id: reward.id,
						signed_transaction: signedClaim,
						proof: claim.proof,
					},
				},
			),
		)
		log('Claimed', claimed)
	} else {
		log('5. No streak reward to claim yet', null)
	}

	step('6. Log out')
	await endSession(trepa)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
