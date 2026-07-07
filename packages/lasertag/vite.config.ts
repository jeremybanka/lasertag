import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: {
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
			"eslint-plugin": "eslint/src/plugin.ts",
			refractor: "refractor/src/index.ts",
		},
		format: "esm",
		outDir: "dist",
	},
	test: {
		include: ["eslint/tests/**/*.test.ts", "refractor/tests/**/*.test.ts"],
	},
})
