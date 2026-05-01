/**
 * 04 - Update an existing prediction's value.
 *
 * Same create -> sign -> submit pattern as placing a prediction, but
 * targeting a `prediction_id` you already own. We pull your most recent
 * active prediction (`filter_by=ACTIVE`) to demonstrate.
 *
 *   $ pnpm example:update-prediction
 */

import { startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'
import { signTransaction } from '../lib/sign.ts'

const NEW_VALUE = 60_000

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const privateKey = requireEnv('TREPA_PRIVATE_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Finding your most recent active prediction')
	const me = unwrap(await trepa.client.GET('/auth/me'))
	const predictions = unwrap(
		await trepa.client.GET('/users/{id}/predictions', {
			params: {
				path: { id: me.id },
				query: { filter_by: ['ACTIVE'], limit: 1 },
			},
		}),
	)

	const target = predictions[0]
	if (!target) {
		throw new Error(
			'No active prediction found. Place one first via `pnpm example:place-prediction`.',
		)
	}
	log('Updating prediction', { id: target.id, current_value: target.prediction })

	step('Creating the update-prediction transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/prediction/update', {
			body: { prediction_id: target.id, value: NEW_VALUE },
		}),
	)

	step('Signing and submitting')
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/prediction/update/submit', {
			body: {
				prediction_id: target.id,
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
