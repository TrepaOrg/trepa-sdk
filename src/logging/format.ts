import type { EventKind, TrepaLogSlot } from './event-kind';
import {
	inkLayoutIsSwarm,
	isInkMounted,
	mountInkIfNeeded,
	pushInkGlobal,
	pushInkSlotLine,
	setInkSwarmLayout,
	unmountInk,
} from './log-ink';
import { SDK_DOCS_URL, SDK_VERSION } from '../core/version';
import { DEFAULT_TREPA_API_BASE_URL } from '../http/session';

export type { EventKind, TrepaLogSlot } from './event-kind';

const leadSymbol = '✦';

const usePlainLogs =
	typeof process === 'undefined' || process.stdout?.isTTY !== true;

/** `true` when stdout is a TTY so the SDK may open Solana websocket subscriptions for the wallet HUD. */
export function trepaBotWalletHudSubscriptionsEnabled(): boolean {
	return typeof process !== 'undefined' && process.stdout?.isTTY === true;
}

/** `true` when swarm Ink layout is active (per-bot columns). */
export function trepaLogSlotLanesEnabled(): boolean {
	return isInkMounted() && inkLayoutIsSwarm();
}

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

/**
 * Logger used by the SDK and available to bots. Uses Ink in a TTY; otherwise `console` methods.
 */
export const trepaLog = {
	log: (msg: string): void => dispatchGlobal('log', msg),
	info: (msg: string): void => dispatchGlobal('info', msg),
	warn: (msg: string): void => dispatchGlobal('warn', msg),
	error: (msg: string): void => dispatchGlobal('error', msg),
	success: (msg: string): void => dispatchGlobal('success', msg),
	ready: (msg: string): void => dispatchGlobal('ready', msg),
	start: (msg: string): void => dispatchGlobal('start', msg),
};

/** Standard swarm startup banner (version, docs, API URL, credential count). */
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
	pushInkGlobal(
		'log',
		`${leadSymbol} @trepa/sdk v${SDK_VERSION} · ${n}-bot swarm`,
	);
	pushInkGlobal('log', `- Docs: ${SDK_DOCS_URL}`);
	pushInkGlobal('log', `- API: ${api}`);
	pushInkGlobal(
		'log',
		`- Credentials: ${n} loaded (${n === 1 ? 'single bot' : `${n}-bot swarm`})`,
	);
	trepaLog.start('Starting predictor loop…');
}

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

export const formatNumber = (value: number, decimals: number): string =>
	value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});

export const formatError = (err: unknown): string => {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
};

/** Emit a line through the same routing as the built-in bot loop (`writeEvent` + optional Ink columns). */
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
