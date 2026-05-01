import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

/**
 * Signs a base64-encoded `VersionedTransaction` returned by any Trepa
 * `create` endpoint with the given embedded-wallet private key (base58),
 * and re-encodes the signed transaction back to base64.
 *
 * The result is the `signed_transaction` you send to the matching
 * `submit` endpoint together with the original `proof`.
 */
export const signTransaction = (
	base64Transaction: string,
	privateKeyBase58: string,
): string => {
	const transaction = VersionedTransaction.deserialize(
		Buffer.from(base64Transaction, 'base64'),
	)

	const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58))
	transaction.sign([keypair])

	return Buffer.from(transaction.serialize()).toString('base64')
}
