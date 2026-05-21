import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { ActionRecord, ActionSink } from './types';

const DEFAULT_LOG_PATH = 'logs/bot-actions.jsonl';

export class FileActionSink implements ActionSink {
	private writeChain: Promise<void> = Promise.resolve();

	constructor(private readonly logPath: string = DEFAULT_LOG_PATH) {}

	async write(records: ActionRecord[]): Promise<void> {
		if (records.length === 0) {
			return;
		}

		const path = resolve(process.cwd(), this.logPath);
		const lines = records.map((record) => JSON.stringify(record)).join('\n');
		const payload = `${lines}\n`;

		this.writeChain = this.writeChain.then(async () => {
			try {
				await mkdir(dirname(path), { recursive: true });
				await appendFile(path, payload, 'utf8');
			} catch (error) {
				console.warn(
					'[action-logger] failed to write log file:',
					error instanceof Error ? error.message : error,
				);
			}
		});
		await this.writeChain;
	}
}

export class CompositeActionSink implements ActionSink {
	constructor(private readonly sinks: ActionSink[]) {}

	async write(records: ActionRecord[]): Promise<void> {
		await Promise.all(this.sinks.map((sink) => sink.write(records)));
	}
}
