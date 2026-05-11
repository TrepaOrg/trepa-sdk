import pkg from '../../package.json' with { type: 'json' };

type PkgMeta = {
	version: string;
	documentation?: string;
};

const meta = pkg as PkgMeta;

/** Current `@trepa/sdk` version. */
export const SDK_VERSION: string = meta.version;

/** Package documentation URL (`package.json` `documentation`, or Trepa developer docs). */
export const SDK_DOCS_URL: string =
	meta.documentation ?? 'https://docs.trepa.io/developers/introduction';
