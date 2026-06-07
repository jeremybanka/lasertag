import type { ESLint } from "eslint"

import * as Rules from "./rules.ts"

export { Rules }

const plugin: ESLint.Plugin = {
	rules: {
		
	},
} satisfies ESLint.Plugin

export default plugin
