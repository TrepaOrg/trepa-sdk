export const fetchBtcPrice = async (): Promise<number> => {
	const res = await fetch(
		'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
	);
	const { price } = (await res.json()) as { price: string };
	return Number(price);
};

export const average = (values: number[], fallback: number): number => {
	if (values.length === 0) return fallback;
	const sum = values.reduce((acc, v) => acc + v, 0);
	return sum / values.length;
};
