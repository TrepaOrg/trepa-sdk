import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';

const rpcByUrl = new Map<string, ReturnType<typeof createSolanaRpc>>();
const subsByUrl = new Map<
	string,
	ReturnType<typeof createSolanaRpcSubscriptions>
>();

/** Reuse Solana HTTP RPC clients per URL (avoids one client per bot HUD). */
export function sharedSolanaRpc(
	url: string,
): ReturnType<typeof createSolanaRpc> {
	let rpc = rpcByUrl.get(url);
	if (!rpc) {
		rpc = createSolanaRpc(url);
		rpcByUrl.set(url, rpc);
	}
	return rpc;
}

/** Reuse Solana WebSocket subscription clients per URL. */
export function sharedSolanaRpcSubscriptions(
	url: string,
): ReturnType<typeof createSolanaRpcSubscriptions> {
	let subs = subsByUrl.get(url);
	if (!subs) {
		subs = createSolanaRpcSubscriptions(url);
		subsByUrl.set(url, subs);
	}
	return subs;
}
