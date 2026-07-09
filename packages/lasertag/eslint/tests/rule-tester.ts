import { RuleTester } from "eslint"
import { describe, it } from "vitest"

RuleTester.describe = describe
RuleTester.it = it

export const ruleTester = new RuleTester({
	languageOptions: {
		parserOptions: {
			ecmaFeatures: { jsx: true },
			sourceType: `module`,
		},
	},
})
