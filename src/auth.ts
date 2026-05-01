import type { TrepaClient } from './client'

/**
 * Exchanges your API key for `trepa-token` and `trepa-refresh` cookies.
 * The cookies are captured automatically by the client's cookie jar, so
 * every later call goes through authenticated.
 *
 * The session endpoint is not declared with a `header` parameter in the
 * OpenAPI spec, so we pass `trepa-api-key` via the per-request `headers`
 * passthrough. This is intentional and supported by openapi-fetch.
 */
export const startSession = async (
	{ client }: TrepaClient,
	apiKey: string,
): Promise<void> => {
	const { response } = await client.POST('/auth/session', {
		headers: { 'trepa-api-key': apiKey },
	})
	if (!response.ok) {
		throw new Error(
			`Failed to start session: ${response.status} ${response.statusText}.`,
		)
	}
}

/**
 * Refreshes an expired `trepa-token` using the existing `trepa-refresh`
 * cookie. Call this when the API rejects a request with 403 (or 401 on
 * `/auth/*`) before retrying it.
 */
export const refreshSession = async ({
	client,
}: TrepaClient): Promise<void> => {
	const { response } = await client.POST('/auth/refresh')
	if (!response.ok) {
		throw new Error(
			`Failed to refresh session: ${response.status} ${response.statusText}.`,
		)
	}
}

/**
 * Invalidates the current refresh token server-side and clears the cookie
 * jar. The original API key is still valid; call `startSession` again to
 * begin a new session.
 */
export const endSession = async ({
	client,
	jar,
}: TrepaClient): Promise<void> => {
	await client.POST('/auth/logout')
	jar.clear()
}
