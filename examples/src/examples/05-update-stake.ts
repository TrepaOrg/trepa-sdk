/**
 * 05 - Update an existing prediction's stake.
 *
 * Same flow as updating the value, but pointing at the stake endpoint.
 *
 *   $ pnpm example:update-stake
 */

import {
	createTrepaClient,
	signTransaction,
	startSession,
	unwrap,
} from '@trepa/sdk'

import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'

const NEW_STAKE = 2

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const privateKey = requireEnv('TREPA_PRIVATE_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Finding your most recent active prediction')
	const me = unwrap(await trepa.client.GET('/auth/me'))
	const [target] = unwrap(
		await trepa.client.GET('/users/{id}/predictions', {
			params: {
				path: { id: me.id },
				query: { filter_by: ['ACTIVE'], limit: 1 },
			},
		}),
	)
	if (!target) {
		throw new Error(
			'No active prediction found. Place one first via `pnpm example:place-prediction`.',
		)
	}
	log('Updating stake on prediction', {
		id: target.id,
		current_stake: target.stake,
	})

	step('Creating the update-stake transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/stake/update', {
			body: { prediction_id: target.id, stake: NEW_STAKE },
		}),
	)

	step('Signing and submitting')
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/stake/update/submit', {
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
