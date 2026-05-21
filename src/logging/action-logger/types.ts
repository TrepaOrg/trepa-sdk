export type ActionMeta = Record<string, unknown>;

export interface ActionRecord {
	ts: string;
	traceId: string;
	scope: string;
	action: string;
	durationMs: number;
	ok: boolean;
	error?: string;
	meta?: ActionMeta;
}

export interface ActionSink {
	write(records: ActionRecord[]): Promise<void>;
}

export interface ActionLoggerConfig {
	/** JSONL path relative to `process.cwd()`. */
	logPath?: string;
	sinks?: ActionSink[];
	/** When false, `logAction` / `runScope` become no-ops. */
	enabled?: boolean;
}
