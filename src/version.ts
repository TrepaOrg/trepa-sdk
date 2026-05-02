import pkg from '../package.json' with { type: 'json' };

type PkgMeta = {
	version: string;
	homepage?: string;
};

const meta = pkg as PkgMeta;

/** Published npm version of `@trepa/sdk` (from package.json at build time). */
export const SDK_VERSION: string = meta.version;

/** Package homepage — SDK docs entry (npm `homepage` field). */
export const SDK_DOCS_URL: string =
	meta.homepage ?? 'https://github.com/TrepaOrg/trepa-sdk#readme';
