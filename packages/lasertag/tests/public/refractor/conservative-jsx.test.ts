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
	it.each([
		`const items = [1, 2]`,
		`const items: readonly number[] = [1, 2]`,
		`const items: [number, number] = [1, 2]`,
	])(`keeps standard array map analysis precise: %s`, (declaration) => {
		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: `${declaration}
export function AppPanel() { return <app-panel class={css.class}>{items.map(() => <span />)}</app-panel> }`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(diagnostics.map(({ code }) => code)).toEqual([`dead-selector`])
	})
	it.each([
		[
			`import { Fragment } from "react"`,
			`<Fragment>{/* @lasertag-adopt-subtree */}</Fragment>`,
		],
		[
			`import { Fragment } from "preact"`,
			`<Fragment children={<span />}>{/* @lasertag-adopt-subtree */}</Fragment>`,
		],
		[
			`import { Show } from "solid-js"`,
			`<Show when={true}>{/* @lasertag-adopt-subtree */}</Show>`,
		],
		[
			`import { For } from "solid-js"`,
			`<For each={[1]} children={() => <span />}>{/* @lasertag-adopt-subtree */}</For>`,
		],
	])(
		`validates directives in comment-only wrapper bodies: %s`,
		(imports, children) => {
			const { renderStory } = validateCssReachability(
				{
					tsxPath: `/project/AppPanel.tsx`,
					tsxSource: `${imports}; export function AppPanel() { return <app-panel class={css.class}>${children}</app-panel> }`,
					cssPath: `/project/AppPanel.module.css`,
					cssSource: conservativeJsxCss,
				},
				session,
			)
			expect(renderStory.warnings.map(({ code }) => code)).toEqual([
				`invalid-adoption-directive`,
			])
		},
	)

	it.each([
		`<Fragment children={undefined} />`,
		`<Fragment>{(undefined as unknown)!}</Fragment>`,
		`<Fragment {...props}><span /></Fragment>`,
		`<Fragment {...props} children={<span />} />`,
		`<Fragment children={<aside />} {...props}><span /></Fragment>`,
		`<Fragment children={<aside />} {...props}>{null}</Fragment>`,
		`<Fragment {...props} children={<span />}>{/* explanation */}</Fragment>`,
	])(`respects fragment children precedence: %s`, (children) => {
		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: `import { Fragment } from "preact"; export function AppPanel(props) { return <app-panel class={css.class}>${children}</app-panel> }`,
				cssPath: `/project/AppPanel.module.css`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(diagnostics.map(({ code }) => code)).toEqual([`dead-selector`])
	})

	it.each([
		`import { Dynamic } from "solid-js/web"; const LocalPanel = (props) => <Dynamic {...props} component="span" />`,
		`import { default as React } from "react"; const LocalPanel = React.memo(() => <span />)`,
		`import React from "react"; const LocalPanel = React /* memoize */ .memo(() => <span />)`,
		`import React from "react"; const LocalPanel = (React.memo)(() => <span />)`,
		`import React from "react"; const LocalPanel = React["memo"](() => <span />)`,
		`import { default as Preact } from "preact/compat"; const LocalPanel = Preact.forwardRef(() => <span />)`,
		`import { memo, forwardRef } from "react"; const LocalPanel = memo(forwardRef(() => <span />))`,
		`import React from "react"; const LocalPanel = React.memo(() => <span />)`,
		`import * as React from "react"; const LocalPanel = React.forwardRef(() => <span />)`,
		`import { memo as stable } from "preact/compat"; const LocalPanel = stable(() => <span />)`,
		`import { Fragment as Group } from "react"; const LocalPanel = () => <Group children={<aside />}><span /></Group>`,
		`import { Fragment } from "preact"; const LocalPanel = () => <Fragment children={<aside />}> </Fragment>`,
		`import { For } from "solid-js"; const LocalPanel = () => <For each={[1]} children={() => <span />} />`,
	])(`keeps precise analysis for supported wrappers: %s`, (declaration) => {
		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: `${declaration}\nexport function AppPanel() { return <app-panel class={css.class}><LocalPanel /></app-panel> }`,
				cssPath: `/project/AppPanel.module.css`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(diagnostics.map(({ code }) => code)).toEqual([`dead-selector`])
	})

	it.each(conservativeJsxCases)(
		`preserves reachable or unknown DOM: $name`,
		(testCase) => {
			const { source } = testCase
			const { diagnostics, renderStory } = validateCssReachability(
				{
					tsxPath: `/project/AppPanel.tsx`,
					tsxSource: source,
					cssPath: `/project/AppPanel.module.css`,
					cssSource: conservativeJsxCss,
				},
				session,
			)
			expect(renderStory.componentName).toBe(
				`componentName` in testCase ? testCase.componentName : `AppPanel`,
			)
			expect(
				diagnostics.filter((diagnostic) => diagnostic.code === `dead-selector`),
			).toEqual([])
		},
	)
})
