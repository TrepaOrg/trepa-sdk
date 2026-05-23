const PREDICT_WINDOW_MS = 15_000;

const UPDATE_WINDOW_START_MS = 25_000;

const UPDATE_WINDOW_END_MS = 28_000;

const SLOT_BUFFER_MS = 1_000;

const slotSpanMs = (windowMs: number): number =>
	Math.max(0, windowMs - SLOT_BUFFER_MS);

const fnv1a = (str: string): number => {
	let h = 2_166_136_261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 1_677_761_9);
	}
	return h >>> 0;
};

type DeployPhase = 'predict' | 'update';

const deployOffsetMs = (
	poolId: string,
	index: number,
	spanMs: number,
	phase: DeployPhase,
): number => {
	const u = fnv1a(`${poolId}:${phase}:${index}`);
	return Math.floor((u / 0x1_0000_0000) * spanMs);
};

const waitUntilDeploySlot = async (
	anchorMs: number,
	deadlineMs: number,
	spanMs: number,
	poolId: string,
	index: number,
	phase: DeployPhase,
): Promise<void> => {
	const now = Date.now();
	if (now >= deadlineMs || spanMs <= 0) return;

	const targetMs = anchorMs + deployOffsetMs(poolId, index, spanMs, phase);
	const waitMs = Math.min(Math.max(0, targetMs - now), deadlineMs - now);

	if (waitMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
};

export const waitUntilPredictSlot = async (
	pool: { id: string; prediction_start_date: string },
	index: number,
): Promise<void> => {
	const startMs = new Date(pool.prediction_start_date).getTime();
	await waitUntilDeploySlot(
		startMs,
		startMs + PREDICT_WINDOW_MS,
		slotSpanMs(PREDICT_WINDOW_MS),
		pool.id,
		index,
		'predict',
	);
};

export const waitUntilUpdateSlot = async (
	pool: { id: string; prediction_start_date: string },
	index: number,
): Promise<void> => {
	const startMs = new Date(pool.prediction_start_date).getTime();
	const updateWindowMs = UPDATE_WINDOW_END_MS - UPDATE_WINDOW_START_MS;
	await waitUntilDeploySlot(
		startMs + UPDATE_WINDOW_START_MS,
		startMs + UPDATE_WINDOW_END_MS,
		slotSpanMs(updateWindowMs),
		pool.id,
		index,
		'update',
	);
};

export const fetchBtcPrice = async (): Promise<number> => {
	const res = await fetch(
		'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
	);
	const { price } = (await res.json()) as { price: string };
	return Number(price);
};

const erfinv = (x: number): number => {
	const a = 0.147;
	const ln = Math.log(1 - x * x);
	const t = 2 / (Math.PI * a) + ln / 2;
	return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
};

export const inverseNormalCdf = (p: number): number => {
	return Math.SQRT2 * erfinv(2 * p - 1);
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
const STDDEV_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const PYTH_FETCH_MAX_ATTEMPTS = 5;
const PYTH_CHUNK_DELAY_MS = 200;

let cachedStddev: { value: number; computedAt: number } | null = null;
let inflightStddev: Promise<number> | null = null;

const delayMs = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const parseRetryAfterMs = (headers: Headers): number | undefined => {
	const raw = headers.get('retry-after');
	if (!raw) return undefined;
	const sec = Number.parseInt(raw, 10);
	if (!Number.isNaN(sec) && sec >= 0) return sec * 1000;
	return undefined;
};

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

	if (inflightStddev !== null) {
		return inflightStddev;
	}

	inflightStddev = (async () => {
		try {
			const value = await computeStdLogReturns();
			cachedStddev = { value, computedAt: Date.now() };
			return value;
		} catch (err) {
			if (
				cachedStddev !== null &&
				Date.now() - cachedStddev.computedAt < STDDEV_STALE_MAX_MS
			) {
				return cachedStddev.value;
			}
			throw err;
		} finally {
			inflightStddev = null;
		}
	})();

	return inflightStddev;
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

	const responses: PythOhlcResponse[] = [];
	for (const { from, to } of dayRanges) {
		if (responses.length > 0) {
			await delayMs(PYTH_CHUNK_DELAY_MS);
		}
		responses.push(await fetchPythOhlc(from, to));
	}

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

	for (let attempt = 1; ; attempt++) {
		const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
		if (res.ok) {
			return (await res.json()) as PythOhlcResponse;
		}

		const transient = res.status === 429 || res.status === 503;
		if (!transient || attempt >= PYTH_FETCH_MAX_ATTEMPTS) {
			throw new Error(`Pyth OHLC chunk returned HTTP ${res.status}`);
		}

		const retryAfterMs = parseRetryAfterMs(res.headers);
		const backoff =
			retryAfterMs ?? Math.min(60_000, 1_000 * 2 ** (attempt - 1));
		await delayMs(backoff + Math.floor(Math.random() * 250));
	}
};
