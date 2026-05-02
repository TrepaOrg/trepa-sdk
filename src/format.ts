import { createConsola } from 'consola';

import { DEFAULT_TREPA_API_BASE_URL } from './session';
import { SDK_DOCS_URL, SDK_VERSION } from './version';

const useColor =
	typeof process !== 'undefined' &&
	process.stdout?.isTTY === true &&
	process.env.NO_COLOR === undefined;

const leadSymbol = '✦';

/**
 * Shared logger for Trepa bots and tooling — no consola tag prefix on lines.
 */
export const trepaLog = createConsola({
	defaults: { tag: '' },
	formatOptions: {
		date: false,
		compact: true,
		colors: useColor,
	},
});

/** Startup banner: SDK version, docs, API, env, credentials, then loop start. */
export function logBotSwarmStartup(opts: {
	credentialCount: number;
	apiBaseUrl?: string;
}): void {
	const api = opts.apiBaseUrl?.trim() || DEFAULT_TREPA_API_BASE_URL;

	trepaLog.log(`${leadSymbol} @trepa/sdk v${SDK_VERSION}`);
	trepaLog.log(`- Docs: ${SDK_DOCS_URL}`);
	trepaLog.log(`- API: ${api}`);

	const n = opts.credentialCount;
	trepaLog.log(
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
 * One-line bot events mapped to consola types. Skip uses `info` so skips align
 * with an icon column (startup banner lines use plain `log` instead).
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
