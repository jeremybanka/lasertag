import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"

const projectRoot = mkdtempSync(path.join(tmpdir(), `lasertag-jsx-factory-`))
const session = createTypescriptAstSession()
let projectIndex = 0
afterAll(() => {
	session.close()
	rmSync(projectRoot, { recursive: true, force: true })
})

function analyze({
	compilerOptions,
	preamble = ``,
	parameter = `props`,
	bindings = ``,
}: {
	compilerOptions?: Record<string, unknown>
	preamble?: string
	parameter?: string
	bindings?: string
}) {
	const directory = path.join(projectRoot, String(projectIndex++))
	mkdirSync(directory)
	if (compilerOptions) {
		writeFileSync(
			path.join(directory, `tsconfig.json`),
			JSON.stringify({ compilerOptions }),
		)
	}
	const tsxPath = path.join(directory, `ProbePanel.tsx`)
	const tsxSource = `${preamble}
import css from "./ProbePanel.module.css"
function LocalChild() { return <span /> }
export function ProbePanel(${parameter}) {
	${bindings}
	return <probe-panel className={css.class}>
		<button {...props}><LocalChild /></button>
		<button {...props}><><span /></></button>
	</probe-panel>
}`
	writeFileSync(tsxPath, tsxSource)
	return validateCssReachability(
		{
			tsxPath,
			tsxSource,
			cssSource: `probe-panel.class { > button > span {} }`,
		},
		session,
	).diagnostics.map(({ code }) => code)
}

it.each([
	{ name: `production default`, compilerOptions: { jsx: `react-jsx` } },
	{ name: `development default`, compilerOptions: { jsx: `react-jsxdev` } },
	{
		name: `explicit React source`,
		compilerOptions: { jsx: `react-jsx`, jsxImportSource: `react` },
	},
	{
		name: `preserved JSX with an explicit source`,
		compilerOptions: { jsx: `preserve`, jsxImportSource: `react` },
	},
	{
		name: `file source overrides project source`,
		compilerOptions: { jsx: `react-jsx`, jsxImportSource: `preact` },
		preamble: `/** @jsxImportSource react */`,
	},
	{
		name: `automatic file override ignores classic factory`,
		compilerOptions: { jsx: `react`, jsxFactory: `custom` },
		preamble: `/** @jsxRuntime automatic */`,
	},
	{
		name: `automatic imports cannot be shadowed`,
		compilerOptions: { jsx: `react-jsx` },
		parameter: `props, React, jsx, jsxs`,
	},
	{
		name: `repeated identical source declarations`,
		preamble: `/** @jsxImportSource react */\n/** @jsxImportSource react */`,
	},
])(`recognizes modern JSX: $name`, (testCase) => {
	expect(analyze(testCase)).toEqual([])
})

it.each([
	`preact`,
	`hono/jsx`,
	`hono/jsx/dom`,
	`solid-js`,
	`@emotion/react`,
	`custom-jsx`,
])(
	`does not apply React semantics to automatic provider %s`,
	(jsxImportSource) => {
		expect(
			analyze({
				compilerOptions: { jsx: `react-jsx`, jsxImportSource },
				preamble: `import React from "react"`,
			}),
		).toEqual([`selector-crosses-ownership-boundary`])
	},
)

it.each([
	{ factory: `React.createElement`, preamble: `import React from "react"` },
	{ factory: `UI.createElement`, preamble: `import * as UI from "react"` },
	{
		factory: `UI.createElement`,
		preamble: `import { default as UI } from "react"`,
	},
	{
		factory: `createElement`,
		preamble: `import { createElement } from "react"`,
	},
	{ factory: `h`, preamble: `import { createElement as h } from "react"` },
])(
	`resolves a direct React factory binding: $preamble`,
	({ factory, preamble }) => {
		for (const configuration of [
			{ compilerOptions: { jsx: `react`, jsxFactory: factory }, preamble },
			{
				compilerOptions: { jsx: `preserve` },
				preamble: `/** @jsx ${factory} */\n${preamble}`,
			},
		]) {
			expect(analyze(configuration)).toEqual([])
		}
	},
)

it(`resolves a classic file override through its import`, () => {
	expect(
		analyze({
			compilerOptions: { jsx: `react-jsx`, jsxImportSource: `preact` },
			preamble: `/** @jsxRuntime classic */\n/** @jsx h */\nimport { createElement as h } from "react"`,
		}),
	).toEqual([])
})

it(`does not let an unrelated scope shadow the selected factory`, () => {
	expect(
		analyze({
			compilerOptions: { jsx: `react` },
			preamble: `import React from "react"; function unrelated(React) { return React }`,
		}),
	).toEqual([])
})

it.each([
	{ name: `unbound default`, preamble: ``, factory: `React.createElement` },
	{
		name: `non-React namespace`,
		preamble: `import React from "custom-jsx"`,
		factory: `React.createElement`,
	},
	{
		name: `type-only default`,
		preamble: `import type React from "react"`,
		factory: `React.createElement`,
	},
	{
		name: `type-only namespace`,
		preamble: `import type * as React from "react"`,
		factory: `React.createElement`,
	},
	{
		name: `type-only named import`,
		preamble: `import { type createElement as h } from "react"`,
		factory: `h`,
	},
	{
		name: `unrelated React export`,
		preamble: `import { memo as h } from "react"`,
		factory: `h`,
	},
	{
		name: `unrelated namespace member`,
		preamble: `import React from "react"`,
		factory: `React.memo`,
	},
	{
		name: `arbitrary local factory`,
		preamble: `function h() { return undefined }`,
		factory: `h`,
	},
	{
		name: `local factory alias`,
		preamble: `import React from "react"; const h = React.createElement`,
		factory: `h`,
	},
	{
		name: `barrel import`,
		preamble: `import { createElement as h } from "./react-barrel"`,
		factory: `h`,
	},
	{
		name: `CommonJS factory`,
		preamble: `const React = require("react")`,
		factory: `React.createElement`,
	},
	{
		name: `member chain`,
		preamble: `import React from "react"`,
		factory: `React.DOM.createElement`,
	},
])(
	`keeps unsupported classic bindings conservative: $name`,
	({ preamble, factory }) => {
		expect(
			analyze({
				compilerOptions: { jsx: `react`, jsxFactory: factory },
				preamble,
			}),
		).toEqual([`selector-crosses-ownership-boundary`])
	},
)

it.each([
	{
		preamble: `import React from "react"`,
		factory: `React.createElement`,
		parameter: `props, React`,
	},
	{
		preamble: `import { createElement as h } from "react"`,
		factory: `h`,
		parameter: `props, h`,
	},
	{
		preamble: `import React from "react"`,
		factory: `React.createElement`,
		bindings: `const React = props.factory`,
	},
	{
		preamble: `import { createElement as h } from "react"`,
		factory: `h`,
		bindings: `const { h } = props`,
	},
])(`honors lexical shadowing of $factory`, ({ factory, ...testCase }) => {
	expect(
		analyze({
			...testCase,
			compilerOptions: { jsx: `react`, jsxFactory: factory },
		}),
	).toEqual([`selector-crosses-ownership-boundary`])
})

it.each([
	{
		name: `bare preserved JSX`,
		compilerOptions: { jsx: `preserve` },
		preamble: `import React from "react"`,
	},
	{ name: `inferred project`, preamble: `import React from "react"` },
	{
		name: `conflicting import sources`,
		preamble: `/** @jsxImportSource react */\n/** @jsxImportSource solid-js */`,
	},
	{
		name: `missing import source`,
		compilerOptions: { jsx: `react-jsx` },
		preamble: `/** @jsxImportSource */`,
	},
	{
		name: `unknown transform mode`,
		compilerOptions: { jsx: `react-jsx` },
		preamble: `/** @jsxRuntime custom */`,
	},
	{
		name: `automatic transform with classic pragma`,
		compilerOptions: { jsx: `react-jsx` },
		preamble: `/** @jsx React.createElement */\nimport React from "react"`,
	},
	{
		name: `classic transform with automatic pragma`,
		compilerOptions: { jsx: `react` },
		preamble: `/** @jsxImportSource react */\nimport React from "react"`,
	},
])(`retains uncertainty for $name`, (testCase) => {
	expect(analyze(testCase)).toEqual([`selector-crosses-ownership-boundary`])
})
