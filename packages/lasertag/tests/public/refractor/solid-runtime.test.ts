import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { renderSolid } from "../fixtures/render-solid.ts"
import { solidPropPrecedenceCases } from "../fixtures/solid-prop-precedence.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each(solidPropPrecedenceCases)(
	`matches compiled Solid SSR output: $name`,
	async ({ source, rendersAside }) => {
		const html = await renderSolid(source)
		expect(html).toMatch(/^<app-panel\b[^>]*class="class\s*"[^>]*>/)
		expect(html.replace(/^<app-panel\b[^>]*>/, `<app-panel>`)).toBe(
			`<app-panel>${rendersAside ? `<aside></aside>` : ``}</app-panel>`,
		)

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
			diagnostics.filter(({ code }) => code === `dead-selector`),
		).toHaveLength(rendersAside ? 0 : 1)
	},
)
