/**
 * 03 - Place a prediction on the current Flash Pool.
 *
 * Demonstrates the create -> sign -> submit pattern that every Trepa
 * transaction endpoint follows:
 *
 *   1. POST /transactions/prediction       (returns { transaction, proof })
 *   2. Decode -> sign -> re-encode the transaction with your wallet key.
 *   3. POST /transactions/prediction/submit (returns { signature })
 *
 * The same pattern reappears for stake updates, claims, and withdrawals.
 *
 *   $ pnpm example:place-prediction
 */

import { startSession } from '../lib/auth.ts'
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
	await startSession(trepa, apiKey)

	step('Finding the current Bitcoin pool')
	const streak = unwrap(await trepa.client.GET('/streak/bitcoin'))
	const details = unwrap(
		await trepa.client.GET('/streak/pool-details', {
			params: { query: { streak_id: streak.id } },
		}),
	)
	if (!details.current_pool) {
		throw new Error('No Bitcoin pool is open right now. Try again later.')
	}
	const poolId = details.current_pool.id
	log('Predicting on pool', { id: poolId, title: details.current_pool.title })

	step('Creating the prediction transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/prediction', {
			body: { pool_id: poolId, stake: STAKE, value: VALUE },
		}),
	)
	log('Created (unsigned)', {
		transaction: `${created.transaction.slice(0, 32)}...`,
		proof: `${created.proof.slice(0, 32)}...`,
	})

	step('Signing with your embedded wallet')
	const signedTransaction = signTransaction(created.transaction, privateKey)

	step('Submitting the signed transaction')
	const submitted = unwrap(
		await trepa.client.POST('/transactions/prediction/submit', {
			body: {
				pool_id: poolId,
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
