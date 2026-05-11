import {
	createKeyPairFromBytes,
	getBase58Encoder,
	getBase64Decoder,
	getBase64Encoder,
	getTransactionDecoder,
	getTransactionEncoder,
	partiallySignTransaction,
} from '@solana/kit';

/** Partially signs a base64 transaction with a base58 secret; returns base64 for submit. */
export const signTransaction = async (
	base64Transaction: string,
	privateKeyBase58: string,
): Promise<string> => {
	const transactionBytes = getBase64Encoder().encode(base64Transaction);
	const transaction = getTransactionDecoder().decode(transactionBytes);

	const secretKeyBytes = getBase58Encoder().encode(privateKeyBase58);
	const keyPair = await createKeyPairFromBytes(secretKeyBytes);

	const signedTransaction = await partiallySignTransaction(
		[keyPair],
		transaction,
	);

	return getBase64Decoder().decode(
		getTransactionEncoder().encode(signedTransaction),
	);
};
