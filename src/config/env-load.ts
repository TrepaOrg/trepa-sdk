import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

let loaded = false;

/** Loads `.env.local` then `.env` once (Node); does not override existing `process.env` keys. */
export function ensureTrepaEnvLoaded(): void {
	if (loaded) return;
	loaded = true;
	if (typeof process === 'undefined') return;

	for (const filePath of ['.env.local', '.env'] as const) {
		if (!filePath || !existsSync(filePath)) continue;
		try {
			loadEnvFile(filePath);
		} catch {}
	}
}
