import {
	createKeyPairFromBytes,
	getBase58Encoder,
	getBase64Decoder,
	getBase64Encoder,
	getTransactionDecoder,
	getTransactionEncoder,
	partiallySignTransaction,
} from '@solana/kit'

/**
 * Signs a base64-encoded wire-format Solana transaction returned by any
 * Trepa `create` endpoint with the given embedded-wallet private key
 * (base58-encoded 64-byte secret key) and re-encodes the signed
 * transaction back to base64.
 *
 * The result is the `signed_transaction` you send to the matching
 * `submit` endpoint together with the original `proof`.
 */
export const signTransaction = async (
	base64Transaction: string,
	privateKeyBase58: string,
): Promise<string> => {
	const transactionBytes =
		getBase64Encoder().encode(base64Transaction)
	const transaction = getTransactionDecoder().decode(transactionBytes)

	const secretKeyBytes = getBase58Encoder().encode(privateKeyBase58)
	const keyPair = await createKeyPairFromBytes(secretKeyBytes)

	const signedTransaction = await partiallySignTransaction(
		[keyPair],
		transaction,
	)

	return getBase64Decoder().decode(
		getTransactionEncoder().encode(signedTransaction),
	)
}
