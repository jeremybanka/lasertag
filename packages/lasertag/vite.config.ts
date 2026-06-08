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
		entry: ["eslint/src/plugin.ts"],
		format: "esm",
		outDir: "eslint/dist",
	},
	test: {
		include: ["eslint/tests/**/*.test.ts"],
	},
})
