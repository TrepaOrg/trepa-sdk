export const fetchBtcPrice = async (): Promise<number> => {
	const res = await fetch(
		'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
	);
	const { price } = (await res.json()) as { price: string };
	return Number(price);
};