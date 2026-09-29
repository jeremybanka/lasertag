import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				// tsdown <0.23 compatibility: resolve external dependency subpaths.
				// Remove to preserve subpath imports as written (the new default).
				// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
				resolveDepSubpath: true,
				dts: {
					neverBundle: [/^[\w@]/],
				},
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: ["src/eslint/plugin.ts", "src/refractor/index.ts"],
				sourcemap: true,
			},
			entry: {
				cli: "src/cli/main.ts",
				"eslint-plugin": "src/eslint/plugin.ts",
				lsp: "src/lsp/server.ts",
				refractor: "src/refractor/index.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: {
		include: ["tests/**/*.test.ts"],
	},
})
