import type { BotCredentials } from './types';
import { ensureTrepaEnvLoaded } from '../config/env-load';
import { TrepaError } from '../core/errors';

const trimEnv = (value: string | undefined): string | undefined => {
	if (value === undefined) return undefined;
	const t = value.trim();
	return t === '' ? undefined : t;
};

/**
 * Reads bot credentials from the environment. Single bot: `TREPA_API_KEY` and `TREPA_PRIVATE_KEY`.
 * Swarm: `TREPA_API_KEY_1` / `TREPA_PRIVATE_KEY_1`, `_2`, …
 *
 * @throws {TrepaError} Missing or incomplete pairs.
 */
export const credentialsFromEnv = (): BotCredentials[] => {
	ensureTrepaEnvLoaded();
	const env: Record<string, string | undefined> =
		typeof process !== 'undefined' && process.env ? process.env : {};

	if (
		env.TREPA_API_KEY_1 !== undefined ||
		env.TREPA_PRIVATE_KEY_1 !== undefined
	) {
		const credentials: BotCredentials[] = [];
		for (let i = 1; ; i++) {
			const apiKey = trimEnv(env[`TREPA_API_KEY_${i}`]);
			const privateKey = trimEnv(env[`TREPA_PRIVATE_KEY_${i}`]);
			if (apiKey === undefined && privateKey === undefined) break;
			if (!apiKey || !privateKey) {
				throw new TrepaError(
					`Incomplete swarm credentials: missing ${
						apiKey ? `TREPA_PRIVATE_KEY_${i}` : `TREPA_API_KEY_${i}`
					}.`,
					{ status: 0, code: 'missing_credentials_env' },
				);
			}
			credentials.push({ apiKey, privateKey });
		}
		return credentials;
	}

	const apiKey = trimEnv(env.TREPA_API_KEY);
	const privateKey = trimEnv(env.TREPA_PRIVATE_KEY);
	if (apiKey && privateKey) return [{ apiKey, privateKey }];
	if (apiKey || privateKey) {
		throw new TrepaError(
			`Incomplete credentials: missing ${
				apiKey ? 'TREPA_PRIVATE_KEY' : 'TREPA_API_KEY'
			}.`,
			{ status: 0, code: 'missing_credentials_env' },
		);
	}

	throw new TrepaError(
		'No Trepa credentials in environment. Set TREPA_API_KEY and ' +
			'TREPA_PRIVATE_KEY, or TREPA_API_KEY_1 / TREPA_PRIVATE_KEY_1 ' +
			'(_2, _3, ...) for a swarm.',
		{ status: 0, code: 'missing_credentials_env' },
	);
};
