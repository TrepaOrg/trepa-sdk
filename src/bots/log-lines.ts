import type {
	BotContext,
	BotOptions,
	BotPredictionInfo,
	BotPredictionUpdatedInfo,
	BotSkippedInfo,
	BotSlot,
} from './types';
import type { EventKind } from '../logging/event-kind';
import {
	formatError,
	formatNumber,
	trepaStdoutIsInteractive,
	writeEvent,
} from '../logging/format';

const SKIP_REASON_LABEL: Record<BotSkippedInfo['reason'], string> = {
	'no-open-pool': 'no open pool',
	'started-mid-pool': 'started mid-window (waiting for next pool)',
	'predict-returned-null': 'strategy returned skip',
	'predict-aborted': 'predict aborted (shutdown)',
	'invalid-value': 'invalid value (not finite)',
	'invalid-stake': 'invalid stake (not finite)',
	'predict-threw': 'strategy threw',
	'predict-too-late': 'past submission deadline',
};

function prefixSlotLine(slot: BotSlot, line: string): string {
	if (slot.count <= 1) return line;
	if (trepaStdoutIsInteractive()) return line;
	return `[${slot.index + 1}/${slot.count}] ${line}`;
}

export function lineForReady(
	options: BotOptions,
	ctx: BotContext,
	slot: BotSlot,
	authMs: number,
): string {
	const custom = options.onStart?.(ctx);
	if (custom !== undefined) return custom;
	return prefixSlotLine(
		slot,
		`Ready — logged in as ${ctx.me.username} (${authMs}ms)`,
	);
}

export function lineForPredicted(
	options: BotOptions,
	info: BotPredictionInfo,
	slot: BotSlot,
): string {
	const custom = options.onPredicted?.(info);
	if (custom !== undefined) return custom;
	const { pool, value, stake } = info;
	return prefixSlotLine(
		slot,
		`Submitted ${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`,
	);
}

export function lineForPredictionUpdated(
	options: BotOptions,
	info: BotPredictionUpdatedInfo,
	slot: BotSlot,
): string {
	const custom = options.onPredictionUpdated?.(info);
	if (custom !== undefined) return custom;
	const { pool, previousValue, value, stake } = info;
	return prefixSlotLine(
		slot,
		`Updated ${pool.title} → ${formatNumber(previousValue, pool.precision)} ` +
			`→ ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`,
	);
}

export function lineForSkipped(
	options: BotOptions,
	info: BotSkippedInfo,
	slot: BotSlot,
): string {
	const custom = options.onPoolSkipped?.(info);
	if (custom !== undefined) return custom;
	const title = info.pool?.title ?? '(no pool)';
	const why = SKIP_REASON_LABEL[info.reason];
	return prefixSlotLine(slot, `${title} — ${why}`);
}

export function lineForError(
	options: BotOptions,
	err: unknown,
	slot: BotSlot,
): string {
	const custom = options.onError?.(err);
	if (custom !== undefined) return custom;
	return prefixSlotLine(slot, formatError(err));
}

export function emit(
	kind: EventKind,
	value: string | void,
	slot: BotSlot,
): void {
	if (typeof value === 'string') writeEvent(kind, value, slot);
}
