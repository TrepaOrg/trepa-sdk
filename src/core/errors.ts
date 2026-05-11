interface TrepaErrorOptions {
	status: number;
	code?: string;
	body?: unknown;
	cause?: unknown;
}

/** Non-success Trepa HTTP response (`status`, optional `code` / `body`). */
export class TrepaError extends Error {
	readonly status: number;
	readonly code?: string;
	readonly body: unknown;

	constructor(message: string, options: TrepaErrorOptions) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'TrepaError';
		this.status = options.status;
		this.code = options.code;
		this.body = options.body;
	}
}

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

export const errorFromResponse = (
	response: Response,
	body: unknown,
	fallback: string,
	unparsedTextBody = false,
): TrepaError => {
	const baseFallback =
		`${fallback}: ${response.status} ${response.statusText}`.trim();
	const message = unparsedTextBody
		? baseFallback
		: messageFromBody(body, baseFallback);
	return new TrepaError(message, {
		status: response.status,
		code: codeFromBody(body),
		body,
	});
};
