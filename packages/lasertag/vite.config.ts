import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				dts: {
					neverBundle: [/^[\w@]/],
				},
				onlyBundle: [],
				skipNodeModulesBundle: true,
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
		include: [
			"cli/tests/**/*.test.ts",
			"eslint/tests/**/*.test.ts",
			"lsp/tests/**/*.test.ts",
			"refractor/tests/**/*.test.ts",
			"vscode/tests/**/*.test.ts",
		],
	},
})
