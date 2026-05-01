/**
 * 01 - Open an authenticated session.
 *
 * Exchanges your API key for `trepa-token` and `trepa-refresh` cookies, then
 * verifies the session by calling `GET /auth/me`. Run this first to confirm
 * your API key works before touching any other example.
 *
 *   $ pnpm example:session
 */

import { endSession, refreshSession, startSession } from '../lib/auth.ts'
import { createTrepaClient, unwrap } from '../lib/client.ts'
import { optionalEnv, requireEnv } from '../lib/env.ts'
import { log, step } from '../lib/log.ts'

const main = async (): Promise<void> => {
	const apiKey = requireEnv('TREPA_API_KEY')
	const baseUrl = optionalEnv('TREPA_API_URL', 'https://www.api.trepa.app')

	const trepa = createTrepaClient({ baseUrl })

	step('Starting session')
	await startSession(trepa, apiKey)
	log('Cookies captured', [...trepa.jar.keys()])

	step('Fetching authenticated user')
	const me = unwrap(await trepa.client.GET('/auth/me'))
	log('Authenticated as', me)

	step('Refreshing session (optional)')
	await refreshSession(trepa)
	log('Cookies after refresh', [...trepa.jar.keys()])

	step('Logging out')
	await endSession(trepa)
	log('Cookies after logout', [...trepa.jar.keys()])
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
