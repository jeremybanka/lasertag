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
		{
			clean: true,
			copy: { from: "../../LasertagIcon.png" },
			deps: {
				neverBundle: ["vscode"],
				onlyBundle: false,
			},
			dts: false,
			entry: { extension: "vscode/extension.ts" },
			format: "cjs",
			outDir: "vscode/dist",
			platform: "node",
		},
		{
			clean: false,
			deps: { onlyBundle: false },
			dts: false,
			entry: { server: "lsp/src/server.ts" },
			format: "esm",
			outDir: "vscode/dist/server",
			platform: "node",
			shims: true,
		},
	],
	test: {
		include: [
			"cli/tests/**/*.test.ts",
			"eslint/tests/**/*.test.ts",
			"lsp/tests/**/*.test.ts",
			"refractor/tests/**/*.test.ts",
		],
	},
})
