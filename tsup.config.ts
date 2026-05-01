import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		schema: 'src/api/schema.ts',
	},
	format: ['esm', 'cjs'],
	target: 'node20',
	dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
	sourcemap: false,
	clean: true,
	treeshake: true,
	splitting: true,
	minify: true,
});
