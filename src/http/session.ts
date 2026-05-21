import createClient, { type Client, type Middleware } from 'openapi-fetch';

import type { paths } from '../api/schema';
import { TrepaError, errorFromResponse } from '../core/errors';

export const DEFAULT_TREPA_API_BASE_URL = 'https://api.trepa.app';

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

const delayMs = (ms: number, signal?: AbortSignal): Promise<void> => {
	if (ms <= 0) return Promise.resolve();
	if (!signal) {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
};

const parseRetryAfterMs = (headers: Headers): number | undefined => {
	const raw = headers.get('retry-after');
	if (!raw) return undefined;
	const sec = Number.parseInt(raw, 10);
	if (!Number.isNaN(sec) && sec >= 0) return sec * 1000;
	return undefined;
};

type PostAttempt = { error?: unknown; response: Response };

const fetchWithTransientRetry = async (
	fn: () => Promise<PostAttempt>,
	maxAttempts: number,
	signal?: AbortSignal,
): Promise<PostAttempt> => {
	for (let attempt = 1; ; attempt++) {
		if (signal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
		const result = await fn();
		if (result.response.ok) return result;
		const transient =
			result.response.status === 429 || result.response.status === 503;
		if (!transient || attempt >= maxAttempts) return result;
		const retryAfterMs = parseRetryAfterMs(result.response.headers);
		const backoff =
			retryAfterMs ?? Math.min(60_000, 1_000 * 2 ** (attempt - 1));
		await delayMs(backoff + Math.floor(Math.random() * 250), signal);
	}
};

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
	apiKey?: string;
	privateKey?: string;
	baseUrl?: string;
	signal?: AbortSignal;
}

interface FetchResult<T> {
	data?: T;
	error?: unknown;
	response: Response;
}

export class Session {
	readonly client: Client<paths>;
	readonly baseUrl: string;
	readonly apiKey?: string;
	readonly privateKey?: string;

	private readonly jar: CookieJar = new Map();
	private readonly requestAbort?: AbortSignal;
	private bootstrap?: Promise<void>;

	constructor(config: SessionConfig = {}) {
		this.apiKey = config.apiKey;
		this.privateKey = config.privateKey;
		this.baseUrl = config.baseUrl ?? DEFAULT_TREPA_API_BASE_URL;
		this.requestAbort = config.signal;

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

		const abortMiddleware: Middleware = {
			onRequest: ({ request }) => {
				const s = this.requestAbort;
				if (!s) return;
				if (s.aborted) {
					return new Request(request, {
						signal: AbortSignal.abort(s.reason),
					});
				}
				const incoming = request.signal;
				const merged =
					incoming && !incoming.aborted ? AbortSignal.any([incoming, s]) : s;
				return new Request(request, { signal: merged });
			},
		};

		this.client.use(cookieMiddleware);
		this.client.use(abortMiddleware);
	}

	private throwIfAborted(): void {
		if (this.requestAbort?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
	}

	async request<T>(
		fn: () => Promise<FetchResult<T>>,
		fallbackMessage = 'Trepa API error',
	): Promise<T> {
		await this.ensureSession();
		this.throwIfAborted();
		let result = await fn();

		if (
			(result.response.status === 401 || result.response.status === 403) &&
			this.canRecoverAuth()
		) {
			await this.recoverAuth();
			this.throwIfAborted();
			result = await fn();
		}

		if (result.error !== undefined || !result.response.ok) {
			const resolved = await resolveErrorBody(result.response, result.error);
			throw errorFromResponse(
				result.response,
				resolved.payload,
				fallbackMessage,
				resolved.unparsedText,
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
		const { error, response } = await fetchWithTransientRetry(
			() => this.client.POST('/auth/refresh'),
			8,
			this.requestAbort,
		);
		if (response.ok) return;
		const resolved = await resolveErrorBody(response, error);
		throw errorFromResponse(
			response,
			resolved.payload,
			'Failed to refresh Trepa session',
			resolved.unparsedText,
		);
	}

	async logout(): Promise<void> {
		if (this.requestAbort?.aborted) {
			this.jar.clear();
			this.bootstrap = undefined;
			return;
		}
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
		} catch (err) {
			if (
				this.requestAbort?.aborted ||
				(err instanceof DOMException && err.name === 'AbortError') ||
				(err instanceof Error && err.name === 'AbortError')
			) {
				throw err;
			}
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
		const { error, response } = await fetchWithTransientRetry(
			() =>
				this.client.POST('/auth/session', {
					headers: { 'trepa-api-key': apiKey },
				}),
			8,
			this.requestAbort,
		);
		if (response.ok) return;
		const resolved = await resolveErrorBody(response, error);
		throw errorFromResponse(
			response,
			resolved.payload,
			'Failed to start Trepa session',
			resolved.unparsedText,
		);
	}
}

type JsonBody = { kind: 'json'; value: unknown };
type TextBody = { kind: 'text'; value: string };

const readBodyAfterJsonParse = async (
	response: Response,
): Promise<JsonBody | TextBody | undefined> => {
	if (response.bodyUsed) return undefined;
	try {
		const cloned = response.clone();
		const text = await cloned.text();
		if (!text) return undefined;
		try {
			return { kind: 'json', value: JSON.parse(text) as unknown };
		} catch {
			return { kind: 'text', value: text };
		}
	} catch {
		return undefined;
	}
};

const resolveErrorBody = async (
	response: Response,
	openapiError: unknown | undefined,
): Promise<{ payload: unknown; unparsedText: boolean }> => {
	if (openapiError !== undefined) {
		return { payload: openapiError, unparsedText: false };
	}
	const read = await readBodyAfterJsonParse(response);
	if (read === undefined) return { payload: undefined, unparsedText: false };
	if (read.kind === 'json') return { payload: read.value, unparsedText: false };
	return { payload: read.value, unparsedText: true };
};
