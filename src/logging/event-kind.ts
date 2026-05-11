/** `writeEvent` category and swarm column styling. */
export type EventKind =
	| 'ready'
	| 'pred'
	| 'pred_update'
	| 'skip'
	| 'error'
	| 'fund';

/** Slot target for `writeEvent` when using swarm columns (`index` / `count` match `BotSlot`). */
export interface TrepaLogSlot {
	index: number;
	count: number;
}
