import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
	},
	staged: {
		"*": ["dprint fmt --allow-no-files", "vp check --no-fmt --fix"],
	},
})
