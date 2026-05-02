/**
 * Bot-loop logging via consola — compact dev-server style (Next.js-ish tags, no timestamps).
 */

import { createConsola } from 'consola';

const useColor =
	typeof process !== 'undefined' &&
	process.stdout?.isTTY === true &&
	process.env.NO_COLOR === undefined;

/** Shared logger for Trepa bots and tooling; tag reads like `[trepa]` in the terminal. */
export const trepaLog = createConsola({
	defaults: { tag: 'trepa' },
	formatOptions: {
		date: false,
		compact: true,
		colors: useColor,
	},
});

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
 * One-line bot events mapped to consola types (ready / success / log / error).
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
			trepaLog.log(message);
			break;
		case 'error':
			trepaLog.error(message);
			break;
	}
};
