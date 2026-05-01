/**
 * 09 - Withdraw funds from your embedded wallet.
 *
 * Identical create -> sign -> submit pattern, but the submit endpoint
 * mirrors the create body shape (`to_address`, `amount`).
 *
 *   $ pnpm example:withdraw
 *
 * Configure via env vars (see .env.example):
 *
 *   TREPA_WITHDRAW_TO        - destination Solana address
 *   TREPA_WITHDRAW_AMOUNT    - amount in tokens (decimal)
 *   TREPA_WITHDRAW_MINT      - SPL mint address (e.g. USDC mint)
 */

import { startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'
import { signTransaction } from '../lib/sign.ts'

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const privateKey = requireEnv('TREPA_PRIVATE_KEY')
	const toAddress = requireEnv('TREPA_WITHDRAW_TO')
	const amount = Number(requireEnv('TREPA_WITHDRAW_AMOUNT'))
	const mintAddress = requireEnv('TREPA_WITHDRAW_MINT')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error('TREPA_WITHDRAW_AMOUNT must be a positive number.')
	}

	const trepa = createTrepaClient({ baseUrl })
	await startSession(trepa, apiKey)

	step('Creating the withdraw transaction')
	const created = unwrap(
		await trepa.client.POST('/transactions/withdraw', {
			body: {
				to_address: toAddress,
				amount,
				mint_address: mintAddress,
			},
		}),
	)
	log('Created (unsigned)', {
		transaction: `${created.transaction.slice(0, 32)}...`,
		proof: `${created.proof.slice(0, 32)}...`,
	})

	step('Signing and submitting')
	const signedTransaction = signTransaction(created.transaction, privateKey)
	const submitted = unwrap(
		await trepa.client.POST('/transactions/withdraw/submit', {
			body: {
				to_address: toAddress,
				amount,
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
