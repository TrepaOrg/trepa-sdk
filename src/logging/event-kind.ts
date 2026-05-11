/**
 * Category for {@link writeEvent} and swarm TUI styling (`ready`, `pred`, `pred_update`, `skip`, `error`, `fund`).
 */
export type EventKind =
	| 'ready'
	| 'pred'
	| 'pred_update'
	| 'skip'
	| 'error'
	| 'fund';

/** Target column for slot-scoped lines (same fields as `BotSlot` from `bots/types`). */
export interface TrepaLogSlot {
	index: number;
	count: number;
}
