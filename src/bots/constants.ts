export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const DEFAULT_SOLANA_WS_URL = 'wss://api.mainnet-beta.solana.com';

export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_POST_RESOLVE_BUFFER_MS = 250;
export const DEFAULT_SESSION_STAGGER_MS = 200;

export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export const RESOLVE_PREDICTION_MAX_ATTEMPTS = 24;
export const RESOLVE_PREDICTION_DELAY_MS = 500;
