import { type BotCredentials, Trepa } from '@trepa/sdk';
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
	onStart: ({ me }) => `online as @${me.username}`,
	onPredicted: ({ pool, value }) => `${pool.title} → ${value}`,
	onError: (err) => (err instanceof Error ? err.message : String(err)),
});
