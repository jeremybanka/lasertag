import { afterAll, describe, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import {
	conservativeJsxCases,
	conservativeJsxCss,
} from "../fixtures/conservative-jsx.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

describe(`conservative JSX reachability`, () => {
	it.each(conservativeJsxCases)(
		`preserves reachable or unknown DOM: $name`,
		({ source }) => {
			const { diagnostics } = validateCssReachability(
				{
					tsxPath: `/project/AppPanel.tsx`,
					tsxSource: source,
					cssPath: `/project/AppPanel.module.css`,
					cssSource: conservativeJsxCss,
				},
				session,
			)
			expect(
				diagnostics.filter((diagnostic) => diagnostic.code === `dead-selector`),
			).toEqual([])
		},
	)
})
