/**
 * 07 - Claim a streak reward.
 *
 * Once `GET /streak/user-details` returns a `REWARDED` event with an
 * unclaimed reward in `streak_rewards`, run this example to claim it
 * via the standard create -> sign -> submit flow.
 *
 *   $ pnpm example:claim-streak-reward
 */

import { startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'
import { signTransaction } from '../lib/sign.ts'

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const privateKey = requireEnv('TREPA_PRIVATE_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Finding an unclaimed streak reward')
	const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
	const details = unwrap(
		await trepa.client.GET('/streak/user-details', {
			params: { query: { streak_id: streak.id, is_claimed: false } },
		}),
	)

	const reward = (details.streak_rewards ?? [])[0]
	if (!reward) {
		throw new Error(
			'No unclaimed streak reward found. Win a full streak run first.',
		)
	}
	log('Claiming reward', { id: reward.id, amount: reward.amount })

	step('Creating the claim-streak-reward transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/claim-streak-reward', {
			body: { streak_reward_id: reward.id },
		}),
	)

	step('Signing and submitting')
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/claim-streak-reward/submit', {
			body: {
				streak_reward_id: reward.id,
				signed_transaction: signedTransaction,
				proof: created.proof,
			},
		}),
	)
	log('Submitted', submitted)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
