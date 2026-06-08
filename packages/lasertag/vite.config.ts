import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: {
		clean: true,
		dts: true,
		entry: ["eslint/src/plugin.ts"],
		format: "esm",
		outDir: "eslint/dist",
	},
})
