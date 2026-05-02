/**
 * Console helpers for the bot loop (`writeEvent`, `formatNumber`, `formatError`).
 */

const ANSI = {
	cyan: '\x1b[96m',
	magenta: '\x1b[95m',
	gray: '\x1b[90m',
	red: '\x1b[91m',
	reset: '\x1b[0m',
} as const;

const useColor =
	typeof process !== 'undefined' &&
	process.stdout?.isTTY === true &&
	process.env.NO_COLOR === undefined;

const colorize = (color: string, text: string): string =>
	useColor ? `${color}${text}${ANSI.reset}` : text;

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

const PREFIXES: Record<EventKind, { label: string; color: string }> = {
	ready: { label: 'READY', color: ANSI.cyan },
	pred: { label: 'PRED', color: ANSI.magenta },
	skip: { label: 'SKIP', color: ANSI.gray },
	error: { label: 'ERROR', color: ANSI.red },
};

/**
 * Write `[LEVEL]: message` to stdout (or stderr for errors). Errors get
 * stderr so `bot 2>err.log` keeps working as expected.
 */
export const writeEvent = (kind: EventKind, message: string): void => {
	const { label, color } = PREFIXES[kind];
	const line = `${colorize(color, `[${label}]`)}: ${message}`;
	if (kind === 'error') console.error(line);
	else console.log(line);
};
