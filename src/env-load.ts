import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

let loaded = false;

/**
 * Merge Trepa env files into `process.env` once (Node only).
 *
 * Does **not** overwrite keys already set — container/platform variables win.
 *
 * Files are loaded in order: optional `TREPA_ENV_FILE`, then `.env.local`, then
 * `.env`. Node keeps the first value seen per key, so `.env.local` wins over
 * `.env` for duplicates; either file only fills keys not already set by the
 * host or by an earlier file in this list.
 */
export function ensureTrepaEnvLoaded(): void {
	if (loaded) return;
	loaded = true;
	if (typeof process === 'undefined') return;

	const paths: string[] = [];
	const extra = process.env.TREPA_ENV_FILE?.trim();
	if (extra) paths.push(extra);
	paths.push('.env.local', '.env');

	for (const filePath of paths) {
		if (!filePath || !existsSync(filePath)) continue;
		try {
			loadEnvFile(filePath);
		} catch {
			/* unreadable or invalid — ignore */
		}
	}
}
