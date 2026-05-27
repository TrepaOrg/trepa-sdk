interface TrepaErrorOptions {
	status: number;
	code?: string;
	body?: unknown;
	cause?: unknown;
	operation?: string;
}

interface ErrorBodyShape {
	message?: unknown;
	error?: unknown;
	details?: unknown;
	correlation_id?: unknown;
	path?: unknown;
	status?: unknown;
}

/** Non-success Trepa HTTP response (`status`, optional `code` / `body`). */
export class TrepaError extends Error {
	readonly status: number;
	readonly code?: string;
	readonly body: unknown;
	readonly operation?: string;

	constructor(message: string, options: TrepaErrorOptions) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'TrepaError';
		this.status = options.status;
		this.code = options.code;
		this.body = options.body;
		this.operation = options.operation;
	}

	override toString(): string {
		return formatTrepaError(this);
	}
}

const messageFromValue = (value: unknown): string | undefined => {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (Array.isArray(value) && value.length > 0) {
		return value
			.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
			.join(', ');
	}
	if (typeof value === 'object' && value !== null) {
		const nested = value as ErrorBodyShape;
		if (typeof nested.message === 'string' && nested.message) {
			return nested.message;
		}
	}
	return undefined;
};

const messageFromBody = (body: unknown, fallback: string): string => {
	if (body == null) return fallback;
	if (typeof body === 'string') return body.trim() || fallback;

	if (typeof body === 'object') {
		const shape = body as ErrorBodyShape;
		const primary = messageFromValue(shape.message);
		const details =
			typeof shape.details === 'string' && shape.details.trim()
				? shape.details.trim()
				: undefined;

		if (primary && details && !primary.includes(details)) {
			return `${primary} — ${details}`;
		}
		if (primary) return primary;
		if (details) return details;

		if (typeof shape.error === 'string' && shape.error) return shape.error;
	}

	return fallback;
};

const codeFromBody = (body: unknown): string | undefined => {
	if (body == null || typeof body !== 'object') return undefined;
	const shape = body as ErrorBodyShape;
	return typeof shape.error === 'string' ? shape.error : undefined;
};

const metaFromBody = (body: unknown): string | undefined => {
	if (body == null || typeof body !== 'object') return undefined;
	const shape = body as ErrorBodyShape;
	const parts: string[] = [];
	if (typeof shape.path === 'string' && shape.path) {
		parts.push(`path=${shape.path}`);
	}
	if (typeof shape.correlation_id === 'string' && shape.correlation_id) {
		parts.push(`correlation_id=${shape.correlation_id}`);
	}
	return parts.length > 0 ? parts.join(' ') : undefined;
};

/** Walks `Error.cause` chains (max depth 8). */
export const describeChainedError = (err: unknown): string => {
	if (!(err instanceof Error)) return String(err);
	const parts: string[] = [];
	let e: unknown = err;
	for (let i = 0; i < 8 && e instanceof Error; i++) {
		if (e.message.trim()) parts.push(e.message.trim());
		e = e.cause;
	}
	return parts.length > 0 ? parts.join(' → ') : String(err);
};

/** Formats a {@link TrepaError} with HTTP status, API metadata, and cause chain. */
export const formatTrepaError = (err: TrepaError): string => {
	const statusPrefix = err.status > 0 ? `HTTP ${err.status}` : 'request failed';
	const meta = metaFromBody(err.body);
	const segments = [`TrepaError (${statusPrefix}): ${err.message}`];
	if (meta) segments.push(meta);
	if (err.code) segments.push(`code=${err.code}`);
	const cause = err.cause;
	if (cause) {
		segments.push(`cause: ${describeChainedError(cause)}`);
	}
	return segments.join(' | ');
};

export const errorFromResponse = (
	response: Response,
	body: unknown,
	fallback: string,
	unparsedTextBody = false,
	options?: { operation?: string },
): TrepaError => {
	const baseFallback =
		`${fallback}: ${response.status} ${response.statusText}`.trim();
	const message = unparsedTextBody
		? baseFallback
		: messageFromBody(body, baseFallback);
	const meta = metaFromBody(body);
	const fullMessage =
		meta && !message.includes(meta) ? `${message} (${meta})` : message;

	return new TrepaError(fullMessage, {
		status: response.status,
		code: codeFromBody(body),
		body,
		operation: options?.operation,
	});
};
