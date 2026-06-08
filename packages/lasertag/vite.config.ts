import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: {
		clean: true,
		dts: true,
		entry: ["eslint/src/plugin.ts"],
		format: "esm",
		outDir: "eslint/dist",
	},
	test: {
		exclude: ["**/node_modules/**", "**/.git/**"],
		include: [
			"src/**/*.test.ts",
			"eslint/tests/**/*.test.ts",
		],
	},
})
