import { createRequire } from "node:module"
import path from "node:path"

import { defineConfig } from "vite-plus"

// Vite Plus 1.0 detects only TypeScript 7.0 when choosing its native generator.
const requireFromTypescript = createRequire(
	import.meta.resolve("typescript/package.json"),
)
const typescriptExecutable = path.join(
	path.dirname(
		requireFromTypescript.resolve(
			`@typescript/typescript-${process.platform}-${process.arch}/package.json`,
		),
	),
	"lib",
	process.platform === "win32" ? "tsc.exe" : "tsc",
)

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
				// Select the native compiler explicitly for prerelease TypeScript.
				generator: "tsgo",
				tsgo: { path: typescriptExecutable },
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
		// Integration files launch native compilers and mapper subprocesses too.
		maxWorkers: 2,
		include: ["tests/**/*.test.ts"],
	},
})
