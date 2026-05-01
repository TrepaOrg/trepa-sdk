import createClient, { type Client, type Middleware } from 'openapi-fetch';

import type { paths } from './api/schema';
import { TrepaError, errorFromResponse } from './errors';

const DEFAULT_BASE_URL = 'https://www.api.trepa.app';

const AUTH_COOKIE = 'trepa-token';
const REFRESH_COOKIE = 'trepa-refresh';

type CookieJar = Map<string, string>;

const parseCookiePair = (raw: string): [string, string] | null => {
	const segment = raw.split(';')[0] ?? '';
	const eq = segment.indexOf('=');
	if (eq <= 0) return null;
	return [segment.slice(0, eq).trim(), segment.slice(eq + 1).trim()];
};

const formatCookieHeader = (jar: CookieJar): string =>
	[...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

const captureSetCookies = (response: Response, jar: CookieJar): void => {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const all =
		typeof headers.getSetCookie === 'function'
			? headers.getSetCookie()
			: headers.has('set-cookie')
				? [headers.get('set-cookie') as string]
				: [];
	for (const raw of all) {
		const pair = parseCookiePair(raw);
		if (pair) jar.set(pair[0], pair[1]);
	}
};

export interface SessionConfig {
	/**
	 * Trepa API key. When provided the SDK starts a session lazily on the
	 * first authenticated call and refreshes it transparently on 401/403.
	 */
	apiKey?: string;
	/**
	 * Base58-encoded 64-byte Solana secret key for the wallet that owns the
	 * Trepa account. Required for any method that produces a signed
	 * transaction (predictions, rewards, withdrawals).
	 */
	privateKey?: string;
	/** Override the API origin (defaults to production). */
	baseUrl?: string;
}

interface FetchResult<T> {
	data?: T;
	error?: unknown;
	response: Response;
}

/**
 * Internal HTTP core. Owns the cookie jar, the typed openapi-fetch client,
 * lazy session start, transparent token refresh, and consistent error
 * surfaces. Resource classes call `request()` and never touch cookies
 * themselves.
 */
export class Session {
	readonly client: Client<paths>;
	readonly baseUrl: string;
	readonly apiKey?: string;
	readonly privateKey?: string;

	private readonly jar: CookieJar = new Map();
	private bootstrap?: Promise<void>;

	constructor(config: SessionConfig = {}) {
		this.apiKey = config.apiKey;
		this.privateKey = config.privateKey;
		this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

		this.client = createClient<paths>({
			baseUrl: this.baseUrl,
		});

		const cookieMiddleware: Middleware = {
			onRequest: ({ request }) => {
				if (this.jar.size > 0) {
					request.headers.set('cookie', formatCookieHeader(this.jar));
				}
				return request;
			},
			onResponse: ({ response }) => {
				captureSetCookies(response, this.jar);
				return response;
			},
		};

		this.client.use(cookieMiddleware);
	}

	/**
	 * Run a typed openapi-fetch call, ensuring a session exists, retrying
	 * once on 401/403 with a refresh, and throwing a `TrepaError` on any
	 * non-2xx response.
	 */
	async request<T>(
		fn: () => Promise<FetchResult<T>>,
		fallbackMessage = 'Trepa API error',
	): Promise<T> {
		await this.ensureSession();
		let result = await fn();

		if (
			(result.response.status === 401 || result.response.status === 403) &&
			this.canRecoverAuth()
		) {
			await this.recoverAuth();
			result = await fn();
		}

		if (result.error !== undefined || !result.response.ok) {
			throw errorFromResponse(
				result.response,
				result.error ?? (await safeReadBody(result.response)),
				fallbackMessage,
			);
		}
		return result.data as T;
	}

	requirePrivateKey(operation: string): string {
		if (!this.privateKey) {
			throw new TrepaError(
				`${operation} requires a privateKey, but the Trepa client was constructed without one.`,
				{ status: 0, code: 'missing_private_key' },
			);
		}
		return this.privateKey;
	}

	async refresh(): Promise<void> {
		const { error, response } = await this.client.POST('/auth/refresh');
		if (!response.ok) {
			throw errorFromResponse(
				response,
				error ?? (await safeReadBody(response)),
				'Failed to refresh Trepa session',
			);
		}
	}

	async logout(): Promise<void> {
		await this.client.POST('/auth/logout');
		this.jar.clear();
		this.bootstrap = undefined;
	}

	private canRecoverAuth(): boolean {
		return this.jar.has(REFRESH_COOKIE) || !!this.apiKey;
	}

	private async recoverAuth(): Promise<void> {
		try {
			await this.refresh();
			return;
		} catch {
			// Fall through to a fresh session start when we still have an apiKey.
		}
		if (this.apiKey) {
			this.jar.clear();
			this.bootstrap = undefined;
			await this.ensureSession();
		}
	}

	private ensureSession(): Promise<void> {
		if (this.jar.has(AUTH_COOKIE)) return Promise.resolve();
		if (!this.apiKey) return Promise.resolve();
		if (this.bootstrap) return this.bootstrap;
		this.bootstrap = this.startSession().catch((error) => {
			this.bootstrap = undefined;
			throw error;
		});
		return this.bootstrap;
	}

	private async startSession(): Promise<void> {
		const apiKey = this.apiKey;
		if (!apiKey) {
			throw new TrepaError('Cannot start a Trepa session without an apiKey.', {
				status: 0,
				code: 'missing_api_key',
			});
		}
		const { error, response } = await this.client.POST('/auth/session', {
			headers: { 'trepa-api-key': apiKey },
		});
		if (!response.ok) {
			throw errorFromResponse(
				response,
				error ?? (await safeReadBody(response)),
				'Failed to start Trepa session',
			);
		}
	}
}

const safeReadBody = async (response: Response): Promise<unknown> => {
	if (response.bodyUsed) return undefined;
	try {
		const cloned = response.clone();
		const text = await cloned.text();
		if (!text) return undefined;
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return text;
		}
	} catch {
		return undefined;
	}
};
