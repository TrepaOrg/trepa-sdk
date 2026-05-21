import { address, type Address } from '@solana/addresses';

import type { TrepaClient } from '../http/client';
import type { Trepa } from '../http/trepa';

export interface StakeTokenInfo {
	mint: Address;
	decimals: number;
}

let cached: StakeTokenInfo | undefined;
let inflight: Promise<StakeTokenInfo> | undefined;

/** Clears the in-process stake mint cache (tests only). */
export function resetStakeTokenCache(): void {
	cached = undefined;
	inflight = undefined;
}

/**
 * Resolves stake mint + decimals once per process. Concurrent callers share one
 * `pools.list` request.
 */
export async function resolveStakeTokenFromPools(
	listPools: () => Promise<
		readonly {
			stake_token_mint?: string;
			decimals?: number;
		}[]
	>,
): Promise<StakeTokenInfo> {
	if (cached) {
		return cached;
	}
	if (!inflight) {
		inflight = (async () => {
			const pools = await listPools();
			const p0 = pools[0];
			if (!p0?.stake_token_mint) {
				throw new Error('no pools listed — cannot resolve stake mint');
			}
			const info: StakeTokenInfo = {
				mint: address(p0.stake_token_mint),
				decimals: typeof p0.decimals === 'number' ? p0.decimals : 6,
			};
			cached = info;
			return info;
		})().finally(() => {
			inflight = undefined;
		});
	}
	return inflight;
}

export function resolveStakeTokenFromTrepa(
	trepa: Trepa,
): Promise<StakeTokenInfo> {
	return resolveStakeTokenFromPools(() => trepa.pools.list({ limit: 1 }));
}

export function resolveStakeTokenFromClient(
	client: TrepaClient,
): Promise<StakeTokenInfo> {
	return resolveStakeTokenFromPools(() => client.pools.list({ limit: 1 }));
}
