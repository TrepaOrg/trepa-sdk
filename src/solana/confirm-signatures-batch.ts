import type { Signature } from '@solana/keys';
import type {
	GetEpochInfoApi,
	GetSignatureStatusesApi,
	Rpc,
} from '@solana/rpc';
import { type Commitment, commitmentComparator } from '@solana/rpc-types';

const POLL_INTERVAL_MS = 400;

/**
 * Confirms multiple signatures with batched `getSignatureStatuses` polling
 * (no per-tx WebSocket subscriptions).
 */
export async function confirmSignaturesAtCommitment(
	rpc: Rpc<GetSignatureStatusesApi & GetEpochInfoApi>,
	signatures: readonly Signature[],
	config: Readonly<{
		commitment: Commitment;
		lastValidBlockHeight: bigint;
		abortSignal?: AbortSignal;
	}>,
): Promise<void> {
	if (signatures.length === 0) {
		return;
	}

	const pending = new Set(signatures);

	while (pending.size > 0) {
		config.abortSignal?.throwIfAborted();

		const ordered = [...pending];
		const { value: statuses } = await rpc
			.getSignatureStatuses(ordered)
			.send({ abortSignal: config.abortSignal });

		for (let i = 0; i < ordered.length; i++) {
			const signature = ordered[i]!;
			const status = statuses[i];
			if (status?.err) {
				throw new Error(
					`transaction ${signature} failed: ${JSON.stringify(status.err)}`,
				);
			}
			if (
				status?.confirmationStatus &&
				commitmentComparator(status.confirmationStatus, config.commitment) >= 0
			) {
				pending.delete(signature);
			}
		}

		if (pending.size === 0) {
			return;
		}

		const epoch = await rpc
			.getEpochInfo({ commitment: config.commitment })
			.send({ abortSignal: config.abortSignal });
		if (epoch.blockHeight > config.lastValidBlockHeight) {
			// The blockhash window closed; the tx may still have landed — recheck once.
			const { value: finalStatuses } = await rpc
				.getSignatureStatuses(ordered)
				.send({ abortSignal: config.abortSignal });
			for (let i = 0; i < ordered.length; i++) {
				const signature = ordered[i]!;
				const status = finalStatuses[i];
				if (status?.err) {
					throw new Error(
						`transaction ${signature} failed: ${JSON.stringify(status.err)}`,
					);
				}
				if (
					status?.confirmationStatus &&
					commitmentComparator(status.confirmationStatus, config.commitment) >=
						0
				) {
					pending.delete(signature);
				}
			}
			if (pending.size === 0) {
				return;
			}
			throw new Error(
				`block height ${epoch.blockHeight} exceeded last valid ` +
					`${config.lastValidBlockHeight} before all signatures confirmed`,
			);
		}

		await sleep(POLL_INTERVAL_MS, config.abortSignal);
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(signal!.reason);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
