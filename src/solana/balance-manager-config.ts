/** Optional funder targets per bot (`TREPA_MASTER_PRIVATE_KEY`). */
export interface BotBalanceManagerConfig {
	/** @default 10 */
	usdcTarget?: number;
	/** @default 5 */
	usdcThreshold?: number;
	/** @default 0.05 */
	solTarget?: number;
	/** @default 0.01 */
	solThreshold?: number;
}

export type BalanceManagerConfig = BotBalanceManagerConfig;
