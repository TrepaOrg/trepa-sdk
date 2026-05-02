import pkg from '../package.json' with { type: 'json' };

type PkgMeta = {
	version: string;
	documentation?: string;
};

const meta = pkg as PkgMeta;

/** Published npm version of `@trepa/sdk` (from package.json at build time). */
export const SDK_VERSION: string = meta.version;

/**
 * Developer documentation entry — npm `documentation` field, or Trepa docs
 * ([introduction](https://docs.trepa.io/developers/introduction)).
 */
export const SDK_DOCS_URL: string =
	meta.documentation ?? 'https://docs.trepa.io/developers/introduction';
