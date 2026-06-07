import { defineConfig } from "vite-plus"

export default defineConfig({
	fmt: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		semi: false,
		singleQuote: false,
		useTabs: true,
		printWidth: 80,
		sortPackageJson: true,
	},
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	staged: {
		"*": "vp check --fix",
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
