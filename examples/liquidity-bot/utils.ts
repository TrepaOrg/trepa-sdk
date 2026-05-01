import { type BotOptions, formatError, Trepa } from '@trepa/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const fetchBtcPrice = async (): Promise<number> => {
	const res = await fetch(
		'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
	);
	const { price } = (await res.json()) as { price: string };
	return Number(price);
};

const PYTH_API_URL =
	'https://benchmarks.pyth.network/v1/shims/tradingview/history';
const PYTH_BTC_SYMBOL = 'Crypto.BTC/USD';
const PYTH_RESOLUTION = '1';

const ONE_DAY_SEC = 24 * 3600;
const SEVEN_DAYS_SEC = 7 * ONE_DAY_SEC;
const MIN_COVERAGE_RATIO = 0.95;
const MAX_BOUNDARY_DRIFT_SEC = 120;
const MIN_SAMPLE_COUNT = Math.floor((SEVEN_DAYS_SEC / 60) * MIN_COVERAGE_RATIO);

const STDDEV_CACHE_TTL_MS = 30 * 60 * 1000;
let cachedStddev: { value: number; computedAt: number } | null = null;

interface PythOhlcResponse {
	s: string;
	t: number[];
	c: number[];
}

export const fetchBtcStdLogReturns = async (): Promise<number> => {
	if (
		cachedStddev !== null &&
		Date.now() - cachedStddev.computedAt < STDDEV_CACHE_TTL_MS
	) {
		return cachedStddev.value;
	}

	const value = await computeStdLogReturns();
	cachedStddev = { value, computedAt: Date.now() };
	return value;
};

const computeStdLogReturns = async (): Promise<number> => {
	const now = new Date();
	const endTs =
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			0,
			0,
			0,
			0,
		) / 1000;
	const startTs = endTs - SEVEN_DAYS_SEC;

	const dayRanges: { from: number; to: number }[] = [];
	let current = startTs;

	while (current < endTs) {
		const dayEnd = Math.min(current + ONE_DAY_SEC, endTs);
		dayRanges.push({ from: current, to: dayEnd });
		current = dayEnd;
	}

	const responses = await Promise.all(
		dayRanges.map(({ from, to }) => fetchPythOhlc(from, to)),
	);

	const candles: Array<{ timestamp: number; close: number }> = [];

	for (const data of responses) {
		if (!data || typeof data !== 'object') {
			throw new Error('Pyth OHLC chunk returned malformed response');
		}
		if (data.s !== 'ok') {
			throw new Error(`Pyth OHLC chunk returned non-ok status: ${data.s}`);
		}
		if (!Array.isArray(data.t) || !Array.isArray(data.c)) {
			throw new Error('Pyth OHLC chunk is missing timestamp or close arrays');
		}
		if (data.t.length !== data.c.length) {
			throw new Error(
				`Pyth OHLC timestamp/close length mismatch: ` +
					`t=${data.t.length} c=${data.c.length}`,
			);
		}

		for (let i = 0; i < data.c.length; i++) {
			const timestamp = Number(data.t[i]);
			const close = Number(data.c[i]);

			if (!Number.isFinite(timestamp)) continue;
			if (!Number.isFinite(close) || close <= 0) continue;
			if (timestamp < startTs || timestamp >= endTs) continue;

			candles.push({ timestamp, close });
		}
	}

	candles.sort((a, b) => a.timestamp - b.timestamp);

	const dedupedCandles: Array<{ timestamp: number; close: number }> = [];
	for (const candle of candles) {
		const previous = dedupedCandles[dedupedCandles.length - 1];
		if (previous && previous.timestamp === candle.timestamp) {
			dedupedCandles[dedupedCandles.length - 1] = candle;
			continue;
		}
		dedupedCandles.push(candle);
	}

	if (dedupedCandles.length < MIN_SAMPLE_COUNT) {
		throw new Error(
			`Pyth OHLC coverage too low: got ${dedupedCandles.length}, ` +
				`expected at least ${MIN_SAMPLE_COUNT}`,
		);
	}

	const first = dedupedCandles[0];
	const last = dedupedCandles[dedupedCandles.length - 1];

	if (first.timestamp > startTs + MAX_BOUNDARY_DRIFT_SEC) {
		throw new Error('Pyth OHLC first candle is too far from requested start');
	}
	if (last.timestamp < endTs - MAX_BOUNDARY_DRIFT_SEC) {
		throw new Error('Pyth OHLC latest candle is too stale for requested end');
	}

	const closes = dedupedCandles.map((c) => c.close);
	const logReturns = closes
		.slice(0, -1)
		.map((_, i) => Math.log(closes[i + 1] / closes[i]));

	const n = logReturns.length;
	const mean = logReturns.reduce((a, b) => a + b, 0) / n;
	const variance =
		logReturns.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
	const std = Math.sqrt(variance);

	if (!Number.isFinite(std) || std <= 0) {
		throw new Error('Pyth 7d: invalid std computed');
	}

	return std;
};

const fetchPythOhlc = async (
	from: number,
	to: number,
): Promise<PythOhlcResponse> => {
	const url = new URL(PYTH_API_URL);
	url.searchParams.set('symbol', PYTH_BTC_SYMBOL);
	url.searchParams.set('resolution', PYTH_RESOLUTION);
	url.searchParams.set('from', String(from));
	url.searchParams.set('to', String(to));

	const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) {
		throw new Error(`Pyth OHLC chunk returned HTTP ${res.status}`);
	}
	return (await res.json()) as PythOhlcResponse;
};

export interface BotSlot {
	index: number;
	count: number;
}

interface BotCredentials {
	apiKey: string;
	privateKey: string;
}

const DEFAULT_CREDENTIALS_PATH = 'bots.credentials.json';

export const runSwarm = async (
	strategy: (slot: BotSlot) => BotOptions,
): Promise<void> => {
	const path = DEFAULT_CREDENTIALS_PATH;
	const credentials = loadCredentials(path);
	const count = credentials.length;

	await Promise.all(
		credentials.map((bot, index) => {
			const trepa = new Trepa({
				apiKey: bot.apiKey,
				privateKey: bot.privateKey,
			});
			const tag = `[${index + 1}/${count}]`;
			const opts = strategy({ index, count });
			return trepa.bot.run({
				...opts,
				onStart: opts.onStart && tagged(tag, opts.onStart),
				onPredicted: opts.onPredicted && tagged(tag, opts.onPredicted),
				onPoolSkipped: opts.onPoolSkipped && tagged(tag, opts.onPoolSkipped),
				onError: opts.onError && tagged(tag, opts.onError),
			});
		}),
	);
};

const tagged =
	<Arg>(tag: string, fn: (arg: Arg) => string | void) =>
	(arg: Arg): string | void => {
		const result = fn(arg);
		return typeof result === 'string' ? `${tag} ${result}` : result;
	};

const loadCredentials = (path: string): BotCredentials[] => {
	const absolutePath = resolve(process.cwd(), path);

	let raw: string;
	try {
		raw = readFileSync(absolutePath, 'utf8');
	} catch (err) {
		throw new Error(
			`Couldn't read bot credentials at ${absolutePath}. ${formatError(err)}`,
		);
	}

	const parsed = JSON.parse(raw) as BotCredentials[];
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error(`${absolutePath}: must be a non-empty array of bots`);
	}
	parsed.forEach((bot, i) => {
		if (!bot.apiKey) throw new Error(`${absolutePath}: [${i}].apiKey missing`);
		if (!bot.privateKey)
			throw new Error(`${absolutePath}: [${i}].privateKey missing`);
	});

	return parsed;
};
