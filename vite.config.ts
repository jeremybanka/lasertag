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
		include: ["packages/*/src/**/*.test.ts"],
	},
})
