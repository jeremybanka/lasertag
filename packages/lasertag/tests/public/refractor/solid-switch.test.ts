import { afterAll, expect, it } from "vite-plus/test"

import {
	canReachSelectorPath,
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { renderSolid } from "../fixtures/render-solid.ts"
import { solidSwitchCases } from "../fixtures/solid-switch.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each(solidSwitchCases)(
	`matches Switch ownership and reachability to Solid output: $name`,
	async ({ source, html, diagnosticCodes, reachability }) => {
		expect(await renderSolid(source)).toBe(html)
		const { diagnostics, renderStory } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: source,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(diagnostics.map(({ code }) => code)).toEqual(diagnosticCodes)
		expect(
			canReachSelectorPath(renderStory, [
				{ relation: `self`, tagName: `app-panel` },
				{ relation: `child`, tagName: `aside` },
			]),
		).toBe(reachability)
	},
)
