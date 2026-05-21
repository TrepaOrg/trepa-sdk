import { FileActionSink } from './sinks';
import type {
	ActionLoggerConfig,
	ActionMeta,
	ActionRecord,
	ActionSink,
} from './types';

export type {
	ActionLoggerConfig,
	ActionMeta,
	ActionRecord,
	ActionSink,
} from './types';
export { CompositeActionSink, FileActionSink } from './sinks';

interface ScopeFrame {
	traceId: string;
	path: string[];
	meta: ActionMeta;
	events: ActionRecord[];
	startedAt: number;
}

let enabled = true;
let sinks: ActionSink[] = [new FileActionSink()];
const scopeStack: ScopeFrame[] = [];

export function configureActionLogger(config: ActionLoggerConfig = {}): void {
	if (config.enabled !== undefined) {
		enabled = config.enabled;
	}
	if (config.sinks !== undefined) {
		sinks = config.sinks;
		return;
	}
	if (config.logPath !== undefined) {
		sinks = [new FileActionSink(config.logPath)];
	}
}

export function isActionLoggingActive(): boolean {
	return enabled && scopeStack.length > 0;
}

export function getActiveTraceHeaders(): {
	traceId: string;
	flow: string;
} | null {
	const frame = currentFrame();
	if (!frame) {
		return null;
	}
	return {
		traceId: frame.traceId,
		flow: frame.path.join('.'),
	};
}

/**
 * Run a block under a named scope. Nested scopes share one `traceId`.
 * Records `total` on exit and flushes buffered events to sinks.
 */
export async function runScope<T>(
	scope: string,
	fn: () => Promise<T>,
	meta?: ActionMeta,
): Promise<T> {
	if (!enabled) {
		return fn();
	}

	const parent = currentFrame();
	const frame: ScopeFrame = {
		traceId: parent?.traceId ?? crypto.randomUUID(),
		path: parent ? [...parent.path, scope] : [scope],
		meta: { ...parent?.meta, ...meta },
		events: [],
		startedAt: performance.now(),
	};

	scopeStack.push(frame);
	let ok = true;
	let caught: unknown;
	try {
		return await fn();
	} catch (error) {
		ok = false;
		caught = error;
		throw error;
	} finally {
		scopeStack.pop();
		record(
			frame,
			'total',
			performance.now() - frame.startedAt,
			ok,
			meta,
			caught,
		);
		await flush(frame.events);
	}
}

/**
 * Log a single async action against the current scope (or a one-off trace if none).
 */
export async function logAction<T>(
	action: string,
	fn: () => Promise<T>,
	meta?: ActionMeta,
): Promise<T> {
	if (!enabled) {
		return fn();
	}

	const frame = currentFrame();
	if (!frame) {
		return runScope(action, fn, meta);
	}

	const start = performance.now();
	try {
		const result = await fn();
		record(frame, action, performance.now() - start, true, meta);
		return result;
	} catch (error) {
		record(frame, action, performance.now() - start, false, meta, error);
		throw error;
	}
}

/** Record an HTTP round-trip when a scope is active (used by Session middleware). */
export function logHttpAction(
	request: Request,
	response: Response,
	startedAt: number,
): void {
	if (!enabled) {
		return;
	}

	const frame = currentFrame();
	if (!frame) {
		return;
	}

	const url = new URL(request.url);
	const path = url.pathname
		.replace(/^\//, '')
		.replace(/\//g, '.')
		.replace(/\{[^}]+\}/g, 'id');
	const action = `http.${request.method.toLowerCase()}.${path || 'root'}`;
	const durationMs = performance.now() - startedAt;

	record(frame, action, durationMs, response.ok, {
		status: response.status,
		method: request.method,
		path: url.pathname,
	});
}

function currentFrame(): ScopeFrame | undefined {
	return scopeStack[scopeStack.length - 1];
}

function record(
	frame: ScopeFrame,
	action: string,
	durationMs: number,
	ok: boolean,
	meta?: ActionMeta,
	error?: unknown,
): void {
	const mergedMeta =
		meta || Object.keys(frame.meta).length > 0
			? { ...frame.meta, ...meta }
			: undefined;

	frame.events.push({
		ts: new Date().toISOString(),
		traceId: frame.traceId,
		scope: frame.path.join('.'),
		action,
		durationMs: Math.round(durationMs * 100) / 100,
		ok,
		...(error !== undefined
			? {
					error: error instanceof Error ? error.message : String(error),
				}
			: {}),
		...(mergedMeta ? { meta: mergedMeta } : {}),
	});
}

async function flush(records: ActionRecord[]): Promise<void> {
	if (records.length === 0 || sinks.length === 0) {
		return;
	}
	await Promise.all(sinks.map((sink) => sink.write(records)));
}
