/**
 * Bot-loop logging via consola — compact dev-server style (Next.js-inspired).
 */

import { createConsola } from 'consola';

import { getTrepaEnvLoadSummary } from './env-load';
import { DEFAULT_TREPA_API_BASE_URL } from './session';
import { SDK_DOCS_URL, SDK_VERSION } from './version';

const useColor =
	typeof process !== 'undefined' &&
	process.stdout?.isTTY === true &&
	process.env.NO_COLOR === undefined;

const leadSymbol = useColor ? '▲' : '>';

/**
 * Shared logger for Trepa bots and tooling; tag reads like `[trepa]` in the
 * terminal (consola compact mode).
 */
export const trepaLog = createConsola({
	defaults: { tag: 'trepa' },
	formatOptions: {
		date: false,
		compact: true,
		colors: useColor,
	},
});

/** Next.js-style startup banner: SDK version, env files, credential count. */
export function logBotSwarmStartup(opts: {
	credentialCount: number;
	apiBaseUrl?: string;
}): void {
	const { loadedFiles } = getTrepaEnvLoadSummary();
	const api = opts.apiBaseUrl?.trim() || DEFAULT_TREPA_API_BASE_URL;

	trepaLog.info(`${leadSymbol} @trepa/sdk v${SDK_VERSION}`);
	trepaLog.info(`- Docs: ${SDK_DOCS_URL}`);
	trepaLog.info(`- API: ${api}`);

	if (loadedFiles.length === 0) {
		trepaLog.info(
			'- Env: no Trepa env file found (.env.local / .env / TREPA_ENV_FILE)',
		);
	} else {
		for (const file of loadedFiles) {
			trepaLog.info(`- Env: loaded ${file}`);
		}
	}

	const n = opts.credentialCount;
	trepaLog.info(
		`- Credentials: ${n} loaded (${n === 1 ? 'single bot' : `${n}-bot swarm`})`,
	);

	trepaLog.start('Starting predictor loop…');
}

/** Printed once when a `Bots.run()` completes (exit, signal, or error). */
export function logBotSwarmShutdown(): void {
	trepaLog.info('Predictor loop stopped');
}

/** Format a number with grouping separators and a fixed decimal count. */
export const formatNumber = (value: number, decimals: number): string =>
	value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});

/** Reduce any thrown value to a `Name: message` string. */
export const formatError = (err: unknown): string => {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
};

export type EventKind = 'ready' | 'pred' | 'skip' | 'error';

/**
 * One-line bot events mapped to consola types. Skip uses `info` (not `log`)
 * so compact output keeps the same icon column as banner/shutdown lines.
 */
export const writeEvent = (kind: EventKind, message: string): void => {
	switch (kind) {
		case 'ready':
			trepaLog.ready(message);
			break;
		case 'pred':
			trepaLog.success(message);
			break;
		case 'skip':
			trepaLog.info(message);
			break;
		case 'error':
			trepaLog.error(message);
			break;
	}
};
