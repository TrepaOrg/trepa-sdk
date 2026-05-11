import pkg from '../../package.json' with { type: 'json' };

type PkgMeta = {
	version: string;
	documentation?: string;
};

const meta = pkg as PkgMeta;

/** @trepa/sdk version string. */
export const SDK_VERSION: string = meta.version;

/** Developer documentation URL. */
export const SDK_DOCS_URL: string =
	meta.documentation ?? 'https://docs.trepa.io/developers/introduction';
