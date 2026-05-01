import {
	type BotCredentials,
	formatError,
	formatNumber,
	Trepa,
} from '@trepa/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const credentials = JSON.parse(
	readFileSync(resolve(process.cwd(), 'bot.credentials.json'), 'utf8'),
) as BotCredentials[];

const trepa = new Trepa({ credentials });

await trepa.bots.run({
	predict: (pool) => ({
		value: (pool.min_outcome + pool.max_outcome) / 2,
		stake: pool.min_stake,
	}),
	onStart: ({ me }) => {
		return `online as ${me.username}`;
	},
	onPredicted: ({ pool, value, stake }) => {
		return `${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`;
	},
	onPoolSkipped: ({ pool, reason }) => {
		return `${pool?.title ?? '(no pool open)'} — ${reason}`;
	},
	onError: (err) => {
		return formatError(err);
	},
});
