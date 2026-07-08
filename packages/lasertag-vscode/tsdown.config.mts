import { defineConfig } from "tsdown"

export default defineConfig([
	{
		clean: false,
		deps: {
			neverBundle: ["vscode"],
			onlyBundle: false,
		},
		dts: false,
		entry: {
			extension: "extension.js",
		},
		format: "cjs",
		outDir: "dist",
		platform: "node",
	},
	{
		clean: false,
		deps: {
			onlyBundle: false,
		},
		dts: false,
		entry: {
			server: "../lasertag/lsp/src/server.ts",
		},
		format: "esm",
		outDir: "dist/server",
		platform: "node",
		shims: true,
		tsconfig: "../../tsconfig.json",
	},
])
