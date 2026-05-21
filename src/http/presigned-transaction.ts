import type { Session } from './session';
import {
	isActionLoggingActive,
	logAction,
	runScope,
} from '../logging/action-logger';

const sign = async (
	transaction: string,
	privateKey: string,
): Promise<string> => {
	const { signTransaction } = await import('./sign');
	return signTransaction(transaction, privateKey);
};

type PreparedTx = { transaction: string; proof: string };

type FetchAttempt<T> = () => Promise<{
	data?: T;
	error?: unknown;
	response: Response;
}>;

export async function runSessionPresignedFlow<TSubmitted>(
	session: Session,
	options: {
		flow: string;
		meta?: Record<string, unknown>;
		operation: string;
		build: FetchAttempt<PreparedTx>;
		buildError: string;
		makeSubmit: (
			prepared: PreparedTx,
			signedTransaction: string,
		) => FetchAttempt<TSubmitted>;
		submitError: string;
	},
): Promise<TSubmitted> {
	const execute = async (): Promise<TSubmitted> => {
		const privateKey = session.requirePrivateKey(options.operation);
		const prepared = await session.request(options.build, options.buildError);
		const signedTransaction = await logAction('sign', () =>
			sign(prepared.transaction, privateKey),
		);
		return session.request(
			options.makeSubmit(prepared, signedTransaction),
			options.submitError,
		);
	};

	if (isActionLoggingActive()) {
		return execute();
	}

	return runScope(`transactions.${options.flow}`, execute, options.meta);
}
