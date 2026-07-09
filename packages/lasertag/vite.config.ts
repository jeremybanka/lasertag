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
			dts: true,
			entry: {
				cli: "cli/src/main.ts",
				"eslint-plugin": "eslint/src/plugin.ts",
				lsp: "lsp/src/server.ts",
				refractor: "refractor/src/index.ts",
			},
			format: "esm",
			outDir: "dist",
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
