import type { ESLint } from "eslint"

import * as Rules from "./rules.ts"

export { Rules }

const plugin: ESLint.Plugin = {
	rules: {
		"ban-div": Rules.banDiv,
	},
} satisfies ESLint.Plugin

export default plugin
