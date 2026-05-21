import type { Signature } from '@solana/keys';
import type {
	GetEpochInfoApi,
	GetSignatureStatusesApi,
	Rpc,
	SendTransactionApi,
} from '@solana/rpc';
import type {
	RpcSubscriptions,
	SignatureNotificationsApi,
	SlotNotificationsApi,
} from '@solana/rpc-subscriptions';
import type { Commitment } from '@solana/rpc-types';
import {
	createBlockHeightExceedencePromiseFactory,
	createRecentSignatureConfirmationPromiseFactory,
	TransactionWithLastValidBlockHeight,
	waitForRecentTransactionConfirmation,
} from '@solana/transaction-confirmation';
import { SendableTransaction, Transaction } from '@solana/transactions';

import { confirmSignaturesAtCommitment } from '../confirm-signatures-batch';
import {
	sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT,
	sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT,
} from './send-transaction-internal';

type SendConfig = Omit<
	Parameters<
		typeof sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT
	>[0],
	'confirmRecentTransaction' | 'rpc' | 'transaction'
>;

export interface SolanaTransactionKit {
	sendAndConfirm: (
		transaction: SendableTransaction &
			Transaction &
			TransactionWithLastValidBlockHeight,
		config: SendConfig,
	) => Promise<void>;
	sendTransaction: (
		transaction: SendableTransaction & Transaction,
		config: SendConfig,
	) => Promise<Signature>;
	confirmSignatures: (
		signatures: readonly Signature[],
		config: Readonly<{
			commitment: Commitment;
			lastValidBlockHeight: bigint;
			abortSignal?: AbortSignal;
		}>,
	) => Promise<void>;
}

type SendAndConfirmTransactionWithBlockhashLifetimeFactoryConfig<TCluster> = {
	rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi> & {
		'~cluster'?: TCluster;
	};
	rpcSubscriptions: RpcSubscriptions<
		SignatureNotificationsApi & SlotNotificationsApi
	> & { '~cluster'?: TCluster };
};

export function sendAndConfirmTransactionFactory({
	rpc,
	rpcSubscriptions,
}: SendAndConfirmTransactionWithBlockhashLifetimeFactoryConfig<'devnet'>): SolanaTransactionKit;
export function sendAndConfirmTransactionFactory({
	rpc,
	rpcSubscriptions,
}: SendAndConfirmTransactionWithBlockhashLifetimeFactoryConfig<'testnet'>): SolanaTransactionKit;
export function sendAndConfirmTransactionFactory({
	rpc,
	rpcSubscriptions,
}: SendAndConfirmTransactionWithBlockhashLifetimeFactoryConfig<'mainnet'>): SolanaTransactionKit;
export function sendAndConfirmTransactionFactory<
	TCluster extends 'devnet' | 'mainnet' | 'testnet' | void = void,
>({
	rpc,
	rpcSubscriptions,
}: SendAndConfirmTransactionWithBlockhashLifetimeFactoryConfig<TCluster>): SolanaTransactionKit {
	const getBlockHeightExceedencePromise =
		createBlockHeightExceedencePromiseFactory({
			rpc,
			rpcSubscriptions,
		} as Parameters<typeof createBlockHeightExceedencePromiseFactory>[0]);
	const getRecentSignatureConfirmationPromise =
		createRecentSignatureConfirmationPromiseFactory({
			rpc,
			rpcSubscriptions,
		} as Parameters<typeof createRecentSignatureConfirmationPromiseFactory>[0]);
	async function confirmRecentTransaction(
		config: Omit<
			Parameters<typeof waitForRecentTransactionConfirmation>[0],
			| 'getBlockHeightExceedencePromise'
			| 'getRecentSignatureConfirmationPromise'
		>,
	) {
		await waitForRecentTransactionConfirmation({
			...config,
			getBlockHeightExceedencePromise,
			getRecentSignatureConfirmationPromise,
		});
	}
	return {
		async sendAndConfirm(transaction, config) {
			await sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT(
				{
					...config,
					confirmRecentTransaction,
					rpc,
					transaction,
				},
			);
		},
		sendTransaction(transaction, config) {
			return sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
				...config,
				rpc,
				transaction,
			});
		},
		confirmSignatures(signatures, config) {
			return confirmSignaturesAtCommitment(rpc, signatures, config);
		},
	};
}
