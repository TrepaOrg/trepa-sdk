import type { Signature } from '@solana/keys';
import type { Rpc, SendTransactionApi } from '@solana/rpc';
import { Commitment, commitmentComparator } from '@solana/rpc-types';
import {
	TransactionWithLastValidBlockHeight,
	waitForRecentTransactionConfirmation,
} from '@solana/transaction-confirmation';
import {
	getBase64EncodedWireTransaction,
	SendableTransaction,
	Transaction,
} from '@solana/transactions';

interface SendAndConfirmTransactionWithBlockhashLifetimeConfig
	extends SendTransactionBaseConfig, SendTransactionConfigWithoutEncoding {
	confirmRecentTransaction: (
		config: Omit<
			Parameters<typeof waitForRecentTransactionConfirmation>[0],
			| 'getBlockHeightExceedencePromise'
			| 'getRecentSignatureConfirmationPromise'
		>,
	) => Promise<void>;
	transaction: SendableTransaction &
		Transaction &
		TransactionWithLastValidBlockHeight;
}

interface SendTransactionBaseConfig extends SendTransactionConfigWithoutEncoding {
	abortSignal?: AbortSignal;
	commitment: Commitment;
	rpc: Rpc<SendTransactionApi>;
	transaction: SendableTransaction & Transaction;
}

type SendTransactionConfigWithoutEncoding = Omit<
	NonNullable<Parameters<SendTransactionApi['sendTransaction']>[1]>,
	'encoding'
>;

function getSendTransactionConfigWithAdjustedPreflightCommitment(
	commitment: Commitment,
	config?: SendTransactionConfigWithoutEncoding,
): SendTransactionConfigWithoutEncoding | void {
	if (
		!config?.preflightCommitment &&
		commitmentComparator(
			commitment,
			'finalized' /* default value of `preflightCommitment` */,
		) < 0
	) {
		return {
			...config,
			preflightCommitment: commitment,
		};
	}
	return config;
}

export async function sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
	abortSignal,
	commitment,
	rpc,
	transaction,
	...sendTransactionConfig
}: SendTransactionBaseConfig): Promise<Signature> {
	const base64EncodedWireTransaction =
		getBase64EncodedWireTransaction(transaction);
	return await rpc
		.sendTransaction(base64EncodedWireTransaction, {
			...getSendTransactionConfigWithAdjustedPreflightCommitment(
				commitment,
				sendTransactionConfig,
			),
			encoding: 'base64',
		})
		.send({ abortSignal });
}

export async function sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT({
	abortSignal,
	commitment,
	confirmRecentTransaction,
	rpc,
	transaction,
	...sendTransactionConfig
}: SendAndConfirmTransactionWithBlockhashLifetimeConfig): Promise<Signature> {
	const transactionSignature =
		await sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
			...sendTransactionConfig,
			abortSignal,
			commitment,
			rpc,
			transaction,
		});
	await confirmRecentTransaction({
		abortSignal,
		commitment,
		transaction,
	});
	return transactionSignature;
}
