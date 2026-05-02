import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

let loaded = false;

/** Paths of env files successfully merged into `process.env` (see {@link ensureTrepaEnvLoaded}). */
export interface TrepaEnvLoadSummary {
	readonly loadedFiles: readonly string[];
}

const emptySummary: TrepaEnvLoadSummary = Object.freeze({ loadedFiles: [] });

let loadSummary: TrepaEnvLoadSummary = emptySummary;

/**
 * Snapshot from the last {@link ensureTrepaEnvLoaded} run. Before the first
 * load, `loadedFiles` is empty.
 */
export function getTrepaEnvLoadSummary(): TrepaEnvLoadSummary {
	return loadSummary;
}

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

	const loadedFiles: string[] = [];

	for (const filePath of paths) {
		if (!filePath || !existsSync(filePath)) continue;
		try {
			loadEnvFile(filePath);
			loadedFiles.push(filePath);
		} catch {
			/* unreadable or invalid — ignore */
		}
	}

	loadSummary = Object.freeze({ loadedFiles: [...loadedFiles] });
}
