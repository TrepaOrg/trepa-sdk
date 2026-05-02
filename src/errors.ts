interface TrepaErrorOptions {
	status: number;
	code?: string;
	body?: unknown;
	cause?: unknown;
}

/**
 * Every non-2xx response from the Trepa API throws a `TrepaError`. The
 * original payload (if any) is preserved on `.body` so callers can inspect
 * structured error fields without re-parsing the response.
 */
export class TrepaError extends Error {
	/** HTTP status of the failing response (`0` for client-side errors). */
	readonly status: number;
	/** Stable error code from the API (e.g. `'missing_api_key'`), if present. */
	readonly code?: string;
	/** Original error payload from the API, untouched. */
	readonly body: unknown;

	constructor(message: string, options: TrepaErrorOptions) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'TrepaError';
		this.status = options.status;
		this.code = options.code;
		this.body = options.body;
	}
}

/** Type guard: narrows an unknown thrown value to `TrepaError`. */
export const isTrepaError = (error: unknown): error is TrepaError =>
	error instanceof TrepaError;

interface ErrorBodyShape {
	message?: unknown;
	error?: unknown;
}

const messageFromBody = (body: unknown, fallback: string): string => {
	if (body == null) return fallback;
	if (typeof body === 'string') return body || fallback;

	if (typeof body === 'object') {
		const shape = body as ErrorBodyShape;
		if (typeof shape.message === 'string' && shape.message) {
			return shape.message;
		}
		if (Array.isArray(shape.message) && shape.message.length > 0) {
			return shape.message
				.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
				.join(', ');
		}
		if (typeof shape.error === 'string' && shape.error) return shape.error;
	}

	return fallback;
};

const codeFromBody = (body: unknown): string | undefined => {
	if (body == null || typeof body !== 'object') return undefined;
	const shape = body as ErrorBodyShape;
	return typeof shape.error === 'string' ? shape.error : undefined;
};

/**
 * Builds a `TrepaError` from a failed HTTP response.
 *
 * @param unparsedTextBody — Response body was not valid JSON (e.g. HTML).
 *   Use the HTTP status line as the message instead of embedding raw text.
 */
export const errorFromResponse = (
	response: Response,
	body: unknown,
	fallback: string,
	unparsedTextBody = false,
): TrepaError => {
	const baseFallback = `${fallback}: ${response.status} ${response.statusText}`.trim();
	const message = unparsedTextBody ? baseFallback : messageFromBody(body, baseFallback);
	return new TrepaError(message, {
		status: response.status,
		code: codeFromBody(body),
		body,
	});
};
