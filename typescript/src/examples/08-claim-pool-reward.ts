/**
 * 08 - Claim a per-pool prize reward.
 *
 * Per-pool prize rewards (separate from streak rewards) follow the same
 * create -> sign -> submit pattern. The create endpoint takes the
 * `pool_id`; the submit endpoint takes the `reward_id`. We pull both off
 * a resolved prediction by including its `pool` and `reward` relations.
 *
 *   $ pnpm example:claim-pool-reward
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

	step('Finding a resolved prediction with an unclaimed reward')
	const me = unwrap(await trepa.client.GET('/auth/me'))
	const predictions = unwrap(
		await trepa.client.GET('/users/{id}/predictions', {
			params: {
				path: { id: me.id },
				query: { filter_by: ['RESOLVED'], includes: ['pool', 'reward'] },
			},
		}),
	)

	const target = predictions.find(
		(prediction) =>
			prediction.reward !== undefined &&
			prediction.reward.is_claimed === false &&
			prediction.pool !== undefined,
	)
	if (!target || !target.reward || !target.pool) {
		throw new Error(
			'No resolved prediction with an unclaimed reward was found.',
		)
	}
	log('Claiming reward', {
		prediction_id: target.id,
		pool_id: target.pool.id,
		reward_id: target.reward.id,
		amount: target.reward.amount,
	})

	step('Creating the claim transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/claim-reward', {
			body: { pool_id: target.pool.id },
		}),
	)

	step('Signing and submitting')
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/claim-reward/submit', {
			body: {
				reward_id: target.reward.id,
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
