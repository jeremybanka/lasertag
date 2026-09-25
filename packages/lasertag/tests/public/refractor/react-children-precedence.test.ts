import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"

const projectRoot = mkdtempSync(path.join(tmpdir(), `lasertag-jsx-consumer-`))
const session = createTypescriptAstSession()
afterAll(() => {
	session.close()
	rmSync(projectRoot, { recursive: true, force: true })
})

function project(name: string, compilerOptions?: Record<string, unknown>) {
	const directory = path.join(projectRoot, name)
	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `ProbePanel.tsx`), `export {}`)
	if (compilerOptions) {
		writeFileSync(
			path.join(directory, `tsconfig.json`),
			JSON.stringify({ compilerOptions }),
		)
	}
	return directory
}

function analyze(
	directory: string,
	output: string,
	preamble = ``,
	selector = `span`,
) {
	return validateCssReachability(
		{
			tsxPath: path.join(directory, `ProbePanel.tsx`),
			cssPath: path.join(directory, `ProbePanel.module.css`),
			tsxSource: `${preamble}
import type { ComponentProps } from "react"
import css from "./ProbePanel.module.css"
function LocalChild() { return <span>Visible content</span> }
function EmptyChild() { return undefined }
export function ProbePanel({ buttonProps }: { buttonProps: ComponentProps<"button"> }) {
	return <probe-panel className={css.class}>${output}</probe-panel>
}`,
			cssSource: `probe-panel.class { > button > ${selector} { color: red; } }`,
		},
		session,
	)
}

const reactProjects = [`react`, `react-jsx`, `react-jsxdev`].map((jsx) => ({
	name: jsx,
	directory: project(jsx, { jsx }),
}))

it.each(
	reactProjects.flatMap(({ name, directory }) =>
		[
			`<button {...buttonProps}><span /></button>`,
			`<button {...buttonProps}><LocalChild /></button>`,
			`<button {...buttonProps}><><span /></></button>`,
			`<button {...buttonProps} children={<LocalChild />} />`,
			`<button {...buttonProps} children={<><span /></>} />`,
			`<button children={undefined} {...buttonProps}><LocalChild /></button>`,
		].map((output) => ({ name, directory, output })),
	),
)(`$name explicit children own their DOM: $output`, ({ directory, output }) => {
	expect(analyze(directory, output).diagnostics).toEqual([])
})

it.each(
	reactProjects.flatMap(({ name, directory }) =>
		[
			`<button {...buttonProps}>{undefined}</button>`,
			`<button {...buttonProps}>{void 0}</button>`,
			`<button {...buttonProps}><EmptyChild /></button>`,
			`<button {...buttonProps}><>{undefined}</></button>`,
			`<button {...buttonProps} children={undefined} />`,
		].map((output) => ({ name, directory, output })),
	),
)(
	`$name empty output cannot restore spread children: $output`,
	({ directory, output }) => {
		expect(
			analyze(directory, output).diagnostics.map(({ code }) => code),
		).toEqual([`dead-selector`])
	},
)

it.each(
	reactProjects.flatMap(({ name, directory }) =>
		[
			`<button {...buttonProps} />`,
			`<button {...buttonProps}>{/* no explicit child */}</button>`,
			`<button {...buttonProps}>\n\t</button>`,
			`<button children={<LocalChild />} {...buttonProps} />`,
		].map((output) => ({ name, directory, output })),
	),
)(
	`$name retains possible spread children: $output`,
	({ directory, output }) => {
		expect(
			analyze(directory, output).diagnostics.map(({ code }) => code),
		).toEqual([`selector-crosses-ownership-boundary`])
	},
)

it.each([
	{ name: `no config`, options: undefined, preamble: `` },
	{ name: `preserved JSX`, options: { jsx: `preserve` }, preamble: `` },
	{
		name: `Solid`,
		options: { jsx: `preserve`, jsxImportSource: `solid-js` },
		preamble: ``,
	},
	{
		name: `custom automatic runtime`,
		options: { jsx: `react-jsx`, jsxImportSource: `custom-jsx` },
		preamble: ``,
	},
	{
		name: `custom classic factory`,
		options: { jsx: `react`, jsxFactory: `custom` },
		preamble: ``,
	},
	{
		name: `Solid file override`,
		options: { jsx: `react-jsx` },
		preamble: `/** @jsxImportSource solid-js */`,
	},
	{
		name: `custom file factory`,
		options: { jsx: `react` },
		preamble: `/** @jsx custom */`,
	},
	{
		name: `custom file consumer`,
		options: { jsx: `react-jsx` },
		preamble: `/** @jsxImportSource custom-jsx */`,
	},
	{
		name: `runtime mentioned in a string`,
		options: undefined,
		preamble: `const text = "/** @jsxImportSource react */"`,
	},
	{
		name: `runtime mentioned after code`,
		options: undefined,
		preamble: `const value = 1\n/** @jsxImportSource react */`,
	},
])(
	`keeps $name conservative despite React type imports`,
	({ name, options, preamble }) => {
		const directory = project(name, options)
		for (const child of [`<LocalChild />`, `<><span /></>`, `{undefined}`]) {
			const { diagnostics } = analyze(
				directory,
				`<button {...buttonProps}>${child}</button>`,
				preamble,
			)
			expect(diagnostics.map(({ code }) => code)).toContain(
				`selector-crosses-ownership-boundary`,
			)
			expect(diagnostics.map(({ code }) => code)).not.toContain(`dead-selector`)
		}
	},
)

it.each([
	`/** @jsxImportSource react */`,
	`/** @jsxRuntime automatic */`,
	`/** @jsxRuntime classic */`,
])(`recognizes explicit React file configuration: %s`, (preamble) => {
	const directory = project(`pragmas`)
	expect(
		analyze(
			directory,
			`<button {...buttonProps}><LocalChild /></button>`,
			preamble,
		).diagnostics,
	).toEqual([])
})

it(`uses inherited project settings`, () => {
	const directory = project(`inherited`)
	writeFileSync(
		path.join(directory, `base.json`),
		JSON.stringify({ compilerOptions: { jsx: `react-jsx` } }),
	)
	writeFileSync(
		path.join(directory, `tsconfig.json`),
		JSON.stringify({ extends: `./base.json` }),
	)
	expect(
		analyze(directory, `<button {...buttonProps}><LocalChild /></button>`)
			.diagnostics,
	).toEqual([])
})

it(`uses a React file override in a Solid project`, () => {
	const directory = project(`React file in Solid`, {
		jsx: `preserve`,
		jsxImportSource: `solid-js`,
	})
	expect(
		analyze(
			directory,
			`<button {...buttonProps}><LocalChild /></button>`,
			`/** @jsxImportSource react */`,
		).diagnostics,
	).toEqual([])
})

it(`preserves addressable asserted roots beneath React spreads`, () => {
	const directory = reactProjects[1]!.directory
	expect(
		analyze(
			directory,
			`<button {...buttonProps}><svg.Icon /></button>`,
			`import { Icon } from "./Icon"; const svg = { Icon }`,
			`svg`,
		).diagnostics,
	).toEqual([])
})

it(`still diagnoses ownership inside explicitly authored foreign components`, () => {
	const directory = reactProjects[1]!.directory
	expect(
		analyze(
			directory,
			`<button {...buttonProps}><svg.Icon /></button>`,
			`import { Icon } from "./Icon"; const svg = { Icon }`,
			`svg > path`,
		).diagnostics.map(({ code }) => code),
	).toEqual([`selector-crosses-ownership-boundary`])
})
