import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	pack: {
		clean: true,
		dts: true,
		entry: ["packages/lasertag/eslint/src/plugin.ts"],
		format: "esm",
		outDir: "packages/lasertag/eslint/dist",
	},
	staged: {
		"*": ["dprint fmt", "vp check --no-fmt --fix"],
	},
	test: {
		exclude: [
			"**/node_modules/**",
			"**/.git/**",
			"packages/*/eslint/tests/HIGH-QUALITY-EXAMPLE.test.ts",
		],
		include: [
			"packages/*/src/**/*.test.ts",
			"packages/*/eslint/tests/**/*.test.ts",
		],
	},
})
