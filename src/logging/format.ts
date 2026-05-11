import type { EventKind, TrepaLogSlot } from './event-kind';
import {
	inkLayoutIsSwarm,
	isInkMounted,
	mountInkIfNeeded,
	pushInkGlobal,
	pushInkSlotLine,
	pushInkSwarmMetaLine,
	setInkSwarmLayout,
	unmountInk,
} from './log-ink';
import { SDK_DOCS_URL, SDK_VERSION } from '../core/version';
import { DEFAULT_TREPA_API_BASE_URL } from '../http/session';

export type { EventKind, TrepaLogSlot } from './event-kind';

const leadSymbol = '✦';

export function trepaStdoutIsInteractive(): boolean {
	return typeof process !== 'undefined' && process.stdout?.isTTY === true;
}

const usePlainLogs = !trepaStdoutIsInteractive();

type GlobalLevel =
	| 'log'
	| 'info'
	| 'warn'
	| 'error'
	| 'success'
	| 'ready'
	| 'start';

function plainLine(level: GlobalLevel, text: string): void {
	if (level === 'error') {
		console.error(text);
		return;
	}
	if (level === 'warn') {
		console.warn(text);
		return;
	}
	console.log(text);
}

function dispatchGlobal(level: GlobalLevel, text: string): void {
	if (usePlainLogs) {
		plainLine(level, text);
		return;
	}
	mountInkIfNeeded();
	pushInkGlobal(level, text);
}

export function writeSwarmMetaLine(message: string): void {
	const t = message.trim();
	if (t.length === 0) return;
	if (usePlainLogs) {
		console.log(`◆ ${t}`);
		return;
	}
	mountInkIfNeeded();
	if (inkLayoutIsSwarm()) {
		pushInkSwarmMetaLine(t);
		return;
	}
	pushInkGlobal('log', t);
}

function formatStaggerDelay(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

/** Fills staggered swarm columns so idle time does not look like a broken UI. */
export function writeSwarmSlotStaggerNotice(
	slot: TrepaLogSlot,
	delayMs: number,
): void {
	if (usePlainLogs || delayMs <= 0) return;
	mountInkIfNeeded();
	if (!isInkMounted() || !inkLayoutIsSwarm()) return;
	pushInkSlotLine(
		slot,
		'skip',
		`Login starts in ${formatStaggerDelay(delayMs)} (staggered)`,
	);
}

/** Structured logger: Ink when stdout is a TTY, otherwise `console`. */
export const trepaLog = {
	log: (msg: string): void => dispatchGlobal('log', msg),
	info: (msg: string): void => dispatchGlobal('info', msg),
	warn: (msg: string): void => dispatchGlobal('warn', msg),
	error: (msg: string): void => dispatchGlobal('error', msg),
	success: (msg: string): void => dispatchGlobal('success', msg),
	ready: (msg: string): void => dispatchGlobal('ready', msg),
	start: (msg: string): void => dispatchGlobal('start', msg),
};

/** Prints the swarm startup banner (TTY: Ink header). */
export function logBotSwarmStartup(opts: {
	credentialCount: number;
	apiBaseUrl?: string;
}): void {
	const api = opts.apiBaseUrl?.trim() || DEFAULT_TREPA_API_BASE_URL;
	const n = opts.credentialCount;

	if (usePlainLogs) {
		console.log(`${leadSymbol} @trepa/sdk v${SDK_VERSION}`);
		console.log(`- Docs: ${SDK_DOCS_URL}`);
		console.log(`- API: ${api}`);
		console.log(
			`- Credentials: ${n} loaded (${n === 1 ? 'single bot' : `${n}-bot swarm`})`,
		);
		console.log('Starting predictor loop…');
		return;
	}

	mountInkIfNeeded();
	setInkSwarmLayout(n);
	pushInkGlobal('log', `${leadSymbol} @trepa/sdk v${SDK_VERSION}`);
	pushInkGlobal('log', `- Docs: ${SDK_DOCS_URL}`);
	pushInkGlobal('log', `- API: ${api}`);
	pushInkGlobal(
		'log',
		`- Credentials: ${n} loaded (${n === 1 ? 'single bot' : `${n}-bot swarm`})`,
	);
	trepaLog.log('Starting predictor loop…');
}

/** Tears down Ink after a swarm run; always logs "Predictor loop stopped". */
export function logBotSwarmShutdown(_opts?: {
	credentialCount?: number;
}): void {
	if (usePlainLogs) {
		console.log('Predictor loop stopped');
		return;
	}
	unmountInk();
	console.log('Predictor loop stopped');
}

/** Fixed-decimal locale string (`en-US`). */
export const formatNumber = (value: number, decimals: number): string =>
	value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});

/** Best-effort string for logging. */
export const formatError = (err: unknown): string => {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
};

/** Bot-loop event: TTY swarm + `slot` → column; else global or plain console. */
export const writeEvent = (
	kind: EventKind,
	message: string,
	slot?: TrepaLogSlot,
): void => {
	if (!usePlainLogs && isInkMounted() && inkLayoutIsSwarm() && slot) {
		pushInkSlotLine(slot, kind, message);
		return;
	}

	if (usePlainLogs) {
		switch (kind) {
			case 'ready':
				plainLine('ready', message);
				break;
			case 'pred':
			case 'pred_update':
			case 'fund':
				plainLine('success', message);
				break;
			case 'skip':
				plainLine('info', message);
				break;
			case 'error':
				plainLine('error', message);
				break;
		}
		return;
	}

	switch (kind) {
		case 'ready':
			pushInkGlobal('ready', message);
			break;
		case 'pred':
		case 'pred_update':
		case 'fund':
			pushInkGlobal('success', message);
			break;
		case 'skip':
			pushInkGlobal('info', message);
			break;
		case 'error':
			pushInkGlobal('error', message);
			break;
	}
};
