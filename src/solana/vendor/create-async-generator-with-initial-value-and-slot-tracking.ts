import type { PendingRpcRequest } from '@solana/rpc';
import type { PendingRpcSubscriptionsRequest } from '@solana/rpc-subscriptions';
import type { SolanaRpcResponse } from '@solana/rpc-types';

type CreateAsyncGeneratorWithInitialValueAndSlotTrackingConfig<
	TRpcValue,
	TSubscriptionValue,
	TItem,
> = Readonly<{
	abortSignal: AbortSignal;
	rpcRequest: PendingRpcRequest<SolanaRpcResponse<TRpcValue>>;
	rpcSubscriptionRequest: PendingRpcSubscriptionsRequest<
		SolanaRpcResponse<TSubscriptionValue>
	>;
	rpcSubscriptionValueMapper: (value: TSubscriptionValue) => TItem;
	rpcValueMapper: (value: TRpcValue) => TItem;
}>;

export async function* createAsyncGeneratorWithInitialValueAndSlotTracking<
	TRpcValue,
	TSubscriptionValue,
	TItem,
>({
	abortSignal,
	rpcRequest,
	rpcValueMapper,
	rpcSubscriptionRequest,
	rpcSubscriptionValueMapper,
}: CreateAsyncGeneratorWithInitialValueAndSlotTrackingConfig<
	TRpcValue,
	TSubscriptionValue,
	TItem
>): AsyncGenerator<SolanaRpcResponse<TItem>> {
	if (abortSignal.aborted) return;

	let lastUpdateSlot = -1n;

	const queue: SolanaRpcResponse<TItem>[] = [];
	let waitingResolve:
		| ((value: IteratorResult<SolanaRpcResponse<TItem>>) => void)
		| null = null;
	let waitingReject: ((reason: unknown) => void) | null = null;
	let rpcDone = false;
	let subscriptionDone = false;
	let done = false;
	let pendingError: unknown;

	function markSourcesDone() {
		done = true;
		if (waitingResolve) {
			const resolve = waitingResolve;
			waitingResolve = null;
			waitingReject = null;
			resolve({ done: true, value: undefined });
		}
	}

	const abortController = new AbortController();
	const signal = abortController.signal;

	function onAbort() {
		done = true;
		abortController.abort(abortSignal.reason);
		if (waitingResolve) {
			const resolve = waitingResolve;
			waitingResolve = null;
			waitingReject = null;
			resolve({ done: true, value: undefined });
		}
	}
	abortSignal.addEventListener('abort', onAbort);

	function enqueue(item: SolanaRpcResponse<TItem>) {
		if (done || signal.aborted) return;
		if (waitingResolve) {
			const resolve = waitingResolve;
			waitingResolve = null;
			waitingReject = null;
			resolve({ done: false, value: item });
		} else {
			queue.push(item);
		}
	}

	function handleError(err: unknown) {
		if (signal.aborted) return;
		done = true;
		pendingError = err;
		abortController.abort(err);
		if (waitingReject) {
			const reject = waitingReject;
			waitingResolve = null;
			waitingReject = null;
			reject(err);
		}
	}

	rpcRequest
		.send({ abortSignal: signal })
		.then(({ context: { slot }, value }) => {
			if (signal.aborted) return;
			if (slot < lastUpdateSlot) return;
			lastUpdateSlot = slot;
			enqueue({ context: { slot }, value: rpcValueMapper(value) });
		})
		.then(() => {
			rpcDone = true;
			if (subscriptionDone) markSourcesDone();
		})
		.catch(handleError);

	rpcSubscriptionRequest
		.subscribe({ abortSignal: signal })
		.then(async (notifications) => {
			for await (const {
				context: { slot },
				value,
			} of notifications) {
				if (signal.aborted) return;
				if (slot < lastUpdateSlot) continue;
				lastUpdateSlot = slot;
				enqueue({
					context: { slot },
					value: rpcSubscriptionValueMapper(value),
				});
			}
			subscriptionDone = true;
			if (rpcDone) markSourcesDone();
		})
		.catch(handleError);

	try {
		while (true) {
			if (pendingError) throw pendingError;
			if (queue.length > 0) {
				yield queue.shift()!;
			} else if (done) {
				return;
			} else {
				const result: IteratorResult<SolanaRpcResponse<TItem>> =
					await new Promise((resolve, reject) => {
						waitingResolve = resolve;
						waitingReject = reject;
					});
				if (result.done) return;
				yield result.value;
			}
		}
	} finally {
		abortSignal.removeEventListener('abort', onAbort);
		if (!signal.aborted) {
			abortController.abort();
		}
	}
}
