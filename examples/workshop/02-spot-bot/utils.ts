export const BTC = async (): Promise<number> => {
	const res = await fetch(
		'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT',
	);
	if (!res.ok) {
		throw new Error(`Binance ticker HTTP ${res.status}`);
	}

	const { price } = (await res.json()) as { price: string };
	const spot = Number(price);

	if (!Number.isFinite(spot) || spot <= 0) {
		throw new Error(`Invalid Binance price: ${price}`);
	}

	return spot;
};
