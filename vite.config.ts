import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
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
