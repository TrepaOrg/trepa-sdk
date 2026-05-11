/**
 * Human-readable stake-token and SOL targets per bot for the optional funder (`TREPA_MASTER_PRIVATE_KEY`).
 * Attach on `Trepa`, `BotSwarmDefaults`, or `BotOptions.balanceManager`.
 */
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
