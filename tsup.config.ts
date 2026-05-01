import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		schema: 'src/api/schema.ts',
	},
	format: ['esm', 'cjs'],
	target: 'node20',
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	splitting: false,
	minify: false,
	noExternal: ['@solana/kit'],
});
