import path from "node:path"

import parser from "@typescript-eslint/parser"
import atomIO from "atom.io/eslint-plugin"
import { defineConfig } from "eslint/config"

export default defineConfig({
	files: ["src/lsp/**/*.ts"],
	languageOptions: {
		parser,
		parserOptions: {
			projectService: true,
			tsconfigRootDir: path.resolve(import.meta.dirname, "../.."),
		},
	},
	plugins: {
		"atom.io": atomIO,
	},
	rules: {
		"atom.io/exact-catch-types": "error",
		"atom.io/explicit-state-types": "error",
		"atom.io/explicit-transaction-types": "error",
		"atom.io/naming-convention": "error",
	},
})
