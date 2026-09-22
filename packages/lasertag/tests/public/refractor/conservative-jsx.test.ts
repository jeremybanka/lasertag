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
