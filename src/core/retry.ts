export const DEFAULT_MAX_ATTEMPTS = 8;

const JITTER_MS = 250;
const BACKOFF_CAP_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;

export const TRANSIENT_HTTP_STATUSES = new Set([429, 503]);

export const isTransientHttpStatus = (status: number): boolean =>
	TRANSIENT_HTTP_STATUSES.has(status);

export const delayMs = (ms: number, signal?: AbortSignal): Promise<void> => {
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

export const parseRetryAfterMs = (headers: Headers): number | undefined => {
	const raw = headers.get('retry-after');
	if (!raw) return undefined;
	const sec = Number.parseInt(raw, 10);
	if (!Number.isNaN(sec) && sec >= 0) return sec * 1000;
	return undefined;
};

export const exponentialBackoffMs = (
	attempt: number,
	capMs = BACKOFF_CAP_MS,
): number => Math.min(capMs, BACKOFF_BASE_MS * 2 ** (attempt - 1));

export const backoffWithJitter = (
	attempt: number,
	retryAfterMs?: number,
): number =>
	(retryAfterMs ?? exponentialBackoffMs(attempt)) +
	Math.floor(Math.random() * JITTER_MS);

export interface RetryOptions {
	maxAttempts?: number;
	signal?: AbortSignal;
}

export type HttpAttempt = { error?: unknown; response: Response };

/** Retries openapi-fetch attempts on 429/503 with exponential backoff. */
export const retryHttpAttempt = async (
	fn: () => Promise<HttpAttempt>,
	options: RetryOptions = {},
): Promise<HttpAttempt> => {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	for (let attempt = 1; ; attempt++) {
		if (options.signal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
		const result = await fn();
		if (result.response.ok) return result;
		if (
			!isTransientHttpStatus(result.response.status) ||
			attempt >= maxAttempts
		) {
			return result;
		}
		await delayMs(
			backoffWithJitter(attempt, parseRetryAfterMs(result.response.headers)),
			options.signal,
		);
	}
};
