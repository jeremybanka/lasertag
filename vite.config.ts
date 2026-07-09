import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
	},
	staged: {
		"*": ["dprint fmt", "vp check --no-fmt --fix"],
	},
})
