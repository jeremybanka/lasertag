import { afterAll, expect, it } from "vite-plus/test"

import { createDeadSelectorCleanupRanges } from "../../../src/lsp/code-actions.ts"
import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import {
	conservativeJsxCases,
	conservativeJsxCss,
} from "../fixtures/conservative-jsx.ts"
import { solidPropPrecedenceCases } from "../fixtures/solid-prop-precedence.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each([
	...conservativeJsxCases.map((testCase) => ({ ...testCase, preserve: true })),
	...solidPropPrecedenceCases
		.filter(({ rendersAside }) => !rendersAside)
		.map((testCase) => ({ ...testCase, preserve: false })),
])(
	`editor cleanup respects rendered children for $name`,
	({ source, preserve }) => {
		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: source,
				cssPath: `/project/AppPanel.module.css`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		const ranges = createDeadSelectorCleanupRanges(
			conservativeJsxCss,
			diagnostics
				.filter((diagnostic) => diagnostic.code === `dead-selector`)
				.flatMap((diagnostic) => (diagnostic.range ? [diagnostic.range] : [])),
		)
		expect(ranges).toHaveLength(preserve ? 0 : 1)
	},
)
