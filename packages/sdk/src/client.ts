import createClient, { type Client, type Middleware } from 'openapi-fetch'
import type { paths } from './api/schema'

/**
 * Auth between the SDK and the Trepa API is cookie-based: a single call to
 * `POST /auth/session` with your API key returns a `trepa-token` (access)
 * and a `trepa-refresh` cookie that must be replayed on every later request.
 *
 * Browsers do this for free; Node's global `fetch` does not. We keep our own
 * tiny in-memory jar and inject/extract the two cookies via openapi-fetch
 * middleware so the rest of the code stays cookie-agnostic.
 */

export type CookieJar = Map<string, string>

export const createCookieJar = (): CookieJar => new Map()

const parseCookiePair = (raw: string): [string, string] | null => {
	const segment = raw.split(';')[0] ?? ''
	const eq = segment.indexOf('=')
	if (eq <= 0) return null
	return [segment.slice(0, eq).trim(), segment.slice(eq + 1).trim()]
}

const formatCookieHeader = (jar: CookieJar): string =>
	[...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

const captureSetCookies = (response: Response, jar: CookieJar): void => {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[]
	}

	const all =
		typeof headers.getSetCookie === 'function'
			? headers.getSetCookie()
			: headers.has('set-cookie')
				? [headers.get('set-cookie') as string]
				: []

	for (const raw of all) {
		const pair = parseCookiePair(raw)
		if (pair) jar.set(pair[0], pair[1])
	}
}

export const DEFAULT_BASE_URL = 'https://www.api.trepa.app'

export interface TrepaClientOptions {
	baseUrl?: string
	jar?: CookieJar
}

export interface TrepaClient {
	client: Client<paths>
	jar: CookieJar
	baseUrl: string
}

export const createTrepaClient = (
	options: TrepaClientOptions = {},
): TrepaClient => {
	const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
	const jar = options.jar ?? createCookieJar()

	const client = createClient<paths>({ baseUrl })

	const cookieMiddleware: Middleware = {
		onRequest: ({ request }) => {
			if (jar.size > 0) {
				request.headers.set('cookie', formatCookieHeader(jar))
			}
			return request
		},
		onResponse: ({ response }) => {
			captureSetCookies(response, jar)
			return response
		},
	}

	client.use(cookieMiddleware)

	return { client, jar, baseUrl }
}

/**
 * Throws on `error` so the calling example can `await` and assume success.
 * Returns the typed `data` payload from the openapi-fetch response.
 */
export const unwrap = <T>(result: { data?: T; error?: unknown }): T => {
	if (result.error !== undefined) {
		const message =
			typeof result.error === 'string'
				? result.error
				: JSON.stringify(result.error)
		throw new Error(`Trepa API error: ${message}`)
	}
	if (result.data === undefined) {
		throw new Error('Trepa API returned no data.')
	}
	return result.data
}
