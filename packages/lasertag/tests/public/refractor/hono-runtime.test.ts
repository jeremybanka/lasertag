import { Hono } from "hono"
import { transform } from "rolldown/utils"
import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { honoCleanupCases } from "../fixtures/hono.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each([
	...honoCleanupCases.map((testCase) => ({ ...testCase, dead: false })),
	...[
		`<Fragment {...props}>{undefined}</Fragment>`,
		`<Fragment {...props} children={undefined} />`,
	].map((output) => ({
		name: `undefined replaces Hono spread children: ${output}`,
		source: `import { Fragment } from "hono/jsx"
const css = { class: "class" }
export function AppPanel(props) {
	return <app-panel class={css.class}>${output}</app-panel>
}
export const render = () => AppPanel({ children: <aside /> })`,
		html: `<app-panel class="class"></app-panel>`,
		dead: true,
	})),
])(
	`matches CSS reachability to actual Hono output: $name`,
	async ({ source, html, dead }) => {
		const { code } = await transform(`AppPanel.tsx`, source, {
			lang: `tsx`,
			jsx: { runtime: `automatic`, importSource: `hono/jsx` },
		})
		const executable = code.replaceAll(
			/from "(hono\/[^"\n]+)"/g,
			(_, specifier: string) =>
				`from ${JSON.stringify(import.meta.resolve(specifier))}`,
		)
		const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString(`base64`)}`
		const { render } = await import(/* @vite-ignore */ moduleUrl)
		const app = new Hono()
		app.get(`/`, (context) => context.html(render()))
		const response = await app.request(`/`)
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(html)

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
		).toHaveLength(dead ? 1 : 0)
	},
)
