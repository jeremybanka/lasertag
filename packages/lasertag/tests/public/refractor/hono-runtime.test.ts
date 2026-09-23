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
	{
		name: `overloads keep local component analysis precise`,
		source: `const css = { class: "class" }
function LocalPanel(props: { ready: true }): any;
function LocalPanel(props: { ready: boolean }) { return <span /> }
export function AppPanel() { return <app-panel class={css.class}><LocalPanel ready={true} /></app-panel> }
export const render = () => AppPanel()`,
		html: `<app-panel class="class"><span></span></app-panel>`,
		dead: true,
	},
	{
		name: `literal sibling keeps dead CSS diagnosable`,
		source: `const css = { class: "class" }
export function AppPanel() {
	return <><app-panel class={css.class}><span /></app-panel>{"text"}</>
}
export const render = () => AppPanel()`,
		html: `<app-panel class="class"><span></span></app-panel>text`,
		dead: true,
	},
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
		const module = await import(/* @vite-ignore */ moduleUrl)
		const render = module.render ?? module.default ?? module.AppPanel
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
