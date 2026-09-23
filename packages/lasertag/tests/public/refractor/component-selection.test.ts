import { afterAll, expect, it } from "vite-plus/test"

import {
	analyzeTsxRenderStories,
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each([
	`fallback || wrap(Render)`,
	`fallback ?? wrap(Render)`,
	`ready && wrap(Render)`,
	`(current = wrap(Render))`,
	`(0, wrap(Render))`,
	`(current ||= wrap(Render))`,
	`(current ??= wrap(Render))`,
	`(current &&= wrap(Render))`,
])(
	`preserves component candidates from operand-returning operators: %s`,
	(initializer) => {
		const { renderStory, diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: `let current; const fallback = undefined; const ready = true
function wrap(Render) { return Render }
const Render = () => <app-panel class={css.class}><aside /></app-panel>
export const AppPanel = ${initializer}
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(renderStory.componentName).toBe(`AppPanel`)
		expect(diagnostics.filter(({ code }) => code === `dead-selector`)).toEqual(
			[],
		)
	},
)

it.each([
	`import Panel from "./unknown"; export default Panel`,
	`export { Panel as default } from "./unknown"`,
	`export default class { render() { return <app-panel class={css.class}><aside /></app-panel> } }`,
])(`keeps unsupported default export identity: %s`, (declaration) => {
	const { renderStory, diagnostics } = validateCssReachability(
		{
			tsxPath: `/project/AppPanel.tsx`,
			tsxSource: `${declaration}
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
			cssSource: conservativeJsxCss,
		},
		session,
	)
	expect(renderStory.componentName).toBe(`default`)
	expect(diagnostics.filter(({ code }) => code === `dead-selector`)).toEqual([])
})

it.each([
	`export default () => <app-panel class={css.class}><span /></app-panel>`,
	`export default function () { return <app-panel class={css.class}><span /></app-panel> }`,
	`import { memo } from "react"; export default memo(() => <app-panel class={css.class}><span /></app-panel>)`,
])(`retains precision for supported default exports: %s`, (declaration) => {
	const { renderStory, diagnostics } = validateCssReachability(
		{
			tsxPath: `/project/AppPanel.tsx`,
			tsxSource: `${declaration}
export function LoadingPanel() { return <app-panel class={css.class}><aside /></app-panel> }`,
			cssSource: conservativeJsxCss,
		},
		session,
	)
	expect(renderStory.componentName).toBe(`default`)
	expect(diagnostics.map(({ code }) => code)).toEqual([`dead-selector`])
})

it(`keeps a Solid component result as a possible component binding`, () => {
	const { diagnostics, renderStory } = validateCssReachability(
		{
			tsxPath: `/project/AppPanel.tsx`,
			tsxSource: `function Factory() {
	return () => <app-panel class={css.class}><aside /></app-panel>
}
export const AppPanel = <Factory />
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
			cssSource: conservativeJsxCss,
		},
		session,
	)
	expect(renderStory.componentName).toBe(`AppPanel`)
	expect(diagnostics.filter(({ code }) => code === `dead-selector`)).toEqual([])
})

it(`excludes non-callable JSX constants from component story discovery`, () => {
	const stories = analyzeTsxRenderStories(
		{
			sourceText: `export const DefaultMarkup = <span />
export const DefaultOptions = { placeholder: <aside /> }
export const WrappedPanel = wrap(() => <wrapped-panel />)
export function AppPanel() { return <app-panel /> }`,
		},
		session,
	)
	expect(stories.map(({ componentName }) => componentName)).toEqual([
		`WrappedPanel`,
		`AppPanel`,
	])
})

it.each(
	[
		`export const DEFAULT_COUNT = 3`,
		`export const DEFAULT_COUNT = 1 + 2`,
		`export const DEFAULT_COUNT = 1 === 1`,
		`export const DEFAULT_COUNT = 1 < 2`,
		`export const DEFAULT_COUNT = 1 << 2`,
		`export const DEFAULT_COUNT = 4 ** 2`,
		`export const DEFAULT_COUNT = "a" + "b"`,
		`export const DEFAULT_COUNT = "key" in { key: 1 }`,
		`export const DEFAULT_COUNT = null instanceof Object`,
		`let count = 0; export const DEFAULT_COUNT = (count += 1)`,
		`export const DEFAULT_COUNT = (-3 as const)`,
		`export const DefaultOptions = { enabled: true }`,
		`export const DEFAULT_ITEMS = [1, 2, 3]`,
		`export const DefaultMarkup = <span />`,
		`const DEFAULT_COUNT = 3; export { DEFAULT_COUNT }`,
		`const DEFAULT_COUNT = 3; export default DEFAULT_COUNT`,
	].flatMap((declaration) =>
		[undefined, `/project/Unrelated.tsx`, `/project/DEFAULT_COUNT.tsx`].map(
			(tsxPath) => ({ declaration, tsxPath }),
		),
	),
)(
	`selects the component beside constants: $declaration ($tsxPath)`,
	({ declaration, tsxPath }) => {
		const { diagnostics, renderStory } = validateCssReachability(
			{
				tsxSource: `${declaration}
export function AppPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
				...(tsxPath ? { tsxPath } : {}),
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(renderStory.componentName).toBe(`AppPanel`)
		expect(renderStory.warnings).toEqual([])
		expect(diagnostics.map(({ code }) => code)).toEqual([`dead-selector`])
	},
)

it.each([undefined, `/project/Unrelated.tsx`, `/project/AppPanel.tsx`])(
	`retains an unknown wrapped component beside constants (%s)`,
	(tsxPath) => {
		const { diagnostics, renderStory } = validateCssReachability(
			{
				tsxSource: `export const DEFAULT_COUNT = 3
function wrap(Render) { return Render }
export const AppPanel = wrap(() => <app-panel class={css.class}><aside /></app-panel>)`,
				...(tsxPath ? { tsxPath } : {}),
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(renderStory.componentName).toBe(`AppPanel`)
		expect(renderStory.warnings).toEqual([])
		expect(diagnostics.filter(({ code }) => code === `dead-selector`)).toEqual(
			[],
		)
	},
)
