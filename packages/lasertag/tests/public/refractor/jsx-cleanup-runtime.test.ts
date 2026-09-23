import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { jsxCleanupSafetyCases } from "../fixtures/jsx-cleanup-safety.ts"
import { renderSolid } from "../fixtures/render-solid.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each(jsxCleanupSafetyCases)(
	`preserves compiled Solid output: $name`,
	async ({ source, html }) => {
		expect(await renderSolid(source)).toBe(html)
		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: source,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(diagnostics.filter(({ code }) => code === `dead-selector`)).toEqual(
			[],
		)
	},
)
