import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';

type PoolDetails = components['schemas']['StreakPoolDetailsDto'];

interface CacheHit<T> {
	value: T;
	expiresAt: number;
}

export interface SharedCache<T> {
	getOrFetch: (
		key: string,
		ttlMs: number,
		fetch: () => Promise<T>,
	) => Promise<T>;
	invalidate: (key?: string) => void;
}

/** TTL cache with in-flight coalescing for swarm-wide shared reads. */
export const createSharedCache = <T>(): SharedCache<T> => {
	const hits = new Map<string, CacheHit<T>>();
	const inflight = new Map<string, Promise<T>>();

	const invalidate = (key?: string): void => {
		if (key === undefined) {
			hits.clear();
			inflight.clear();
			return;
		}
		hits.delete(key);
		inflight.delete(key);
	};

	const getOrFetch = async (
		key: string,
		ttlMs: number,
		fetch: () => Promise<T>,
	): Promise<T> => {
		const now = Date.now();
		const hit = hits.get(key);
		if (hit && hit.expiresAt > now) {
			return hit.value;
		}

		const pending = inflight.get(key);
		if (pending) return pending;

		let promise!: Promise<T>;
		promise = (async () => {
			try {
				const value = await fetch();
				hits.set(key, { value, expiresAt: Date.now() + ttlMs });
				return value;
			} finally {
				if (inflight.get(key) === promise) {
					inflight.delete(key);
				}
			}
		})();

		inflight.set(key, promise);
		return promise;
	};

	return { getOrFetch, invalidate };
};

const poolDetailsCache = createSharedCache<PoolDetails>();

const poolDetailsKey = (baseUrl: string, streakId: string): string =>
	`${baseUrl}\0pool-details\0${streakId}`;

export const fetchSharedPoolDetails = (
	client: TrepaClient,
	streakId: string,
	ttlMs: number,
): Promise<PoolDetails> =>
	poolDetailsCache.getOrFetch(
		poolDetailsKey(client.baseUrl, streakId),
		ttlMs,
		() => client.streaks.poolDetails(streakId),
	);
