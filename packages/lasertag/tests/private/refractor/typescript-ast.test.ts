import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

const apiLifecycle = vi.hoisted(() => ({ closed: 0, created: 0, snapshots: 0 }))

vi.mock(`typescript/sync`, async (importOriginal) => {
	const typescript = await importOriginal<typeof import("typescript/sync")>()

	return {
		...typescript,
		API: class extends typescript.API {
			constructor(options?: ConstructorParameters<typeof typescript.API>[0]) {
				super(options)
				apiLifecycle.created += 1
			}
			override get createSnapshot() {
				apiLifecycle.snapshots++
				return super.createSnapshot
			}

			override get close() {
				const close = super.close
				return Object.assign(
					() => {
						apiLifecycle.closed += 1
						close()
					},
					{ gen: close.gen.bind(close) },
				)
			}
		},
	}
})

import { analyzeTsxRenderStory } from "../../../src/refractor/analyze-tsx.ts"
import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import { runLasertagCheck } from "../../../src/cli/check.ts"
import { analyzeCssOwnershipEvidence } from "../../../src/refractor/css-ownership-evidence.ts"
import { createCssMapperProject } from "./fixtures/css-project.ts"

describe(`TypeScript AST session`, () => {
	beforeEach(() => {
		apiLifecycle.closed = 0
		apiLifecycle.created = 0
		apiLifecycle.snapshots = 0
	})

	it.each([`tsconfig.json`, `base.json`])(
		`refreshes JSX settings after %s changes`,
		(configName) => {
			const projectRoot = mkdtempSync(
				path.join(tmpdir(), `lasertag-session-config-`),
			)
			const filePath = path.join(projectRoot, `ProbePanel.tsx`)
			const configPath = path.join(projectRoot, configName)
			const sourceText = `export function ProbePanel(props) { return <probe-panel {...props}>{undefined}</probe-panel> }`
			writeFileSync(filePath, sourceText)
			if (configName === `base.json`) {
				writeFileSync(
					path.join(projectRoot, `tsconfig.json`),
					JSON.stringify({ extends: `./base.json` }),
				)
			}
			const session = createTypescriptAstSession()
			try {
				for (const jsxImportSource of [`react`, `solid-js`, `react`]) {
					writeFileSync(
						configPath,
						JSON.stringify({
							compilerOptions: { jsx: `react-jsx`, jsxImportSource },
						}),
					)
					const story = analyzeTsxRenderStory(
						{ filePath, sourceText, scopeToCssClassRoots: false },
						session,
					)
					expect(
						JSON.stringify(story).includes(`spread component render props`),
					).toBe(jsxImportSource === `solid-js`)
				}
			} finally {
				session.close()
				rmSync(projectRoot, { recursive: true, force: true })
			}
		},
	)

	it(`reuses one native API while refreshing the source at one path`, () => {
		const session = createTypescriptAstSession()
		const filePath = `/virtual/TrainingPanel.tsx`
		let firstStory
		let secondStory

		try {
			firstStory = analyzeTsxRenderStory(
				{
					filePath,
					sourceText: `export function TrainingPanel() { return <first-panel /> }`,
				},
				session,
			)
			secondStory = analyzeTsxRenderStory(
				{
					filePath,
					sourceText: `export function TrainingPanel() { return <second-panel /> }`,
				},
				session,
			)
		} finally {
			session.close()
			session.close()
		}

		expect(firstStory).toMatchObject({
			roots: [{ kind: `element`, tagName: `first-panel` }],
		})
		expect(secondStory).toMatchObject({
			roots: [{ kind: `element`, tagName: `second-panel` }],
		})
		expect(apiLifecycle).toEqual({ closed: 1, created: 1, snapshots: 1 })
	})

	it(`owns one native API for a serial worker's whole queue`, async () => {
		const firstCssPath = `/virtual/First.module.css`
		const secondCssPath = `/virtual/Second.module.css`
		const sources = new Map<string, string>([
			[firstCssPath, `first-panel.class { > header {} }`],
			[
				`/virtual/First.tsx`,
				`export function First() { return <first-panel><header /></first-panel> }`,
			],
			[secondCssPath, `second-panel.class { > footer {} }`],
			[
				`/virtual/Second.tsx`,
				`export function Second() { return <second-panel><footer /></second-panel> }`,
			],
		])

		const result = await runLasertagCheck([firstCssPath, secondCssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => {
					const sourceText = sources.get(filePath)

					if (sourceText === undefined) throw new Error(`Missing ${filePath}`)

					return sourceText
				},
			},
		})

		expect(result.failures).toEqual([])
		expect(result.fileResults).toHaveLength(2)
		expect(apiLifecycle).toEqual({ closed: 1, created: 1, snapshots: 1 })
	})

	it(`resolves the previous analysis root when the next root imports it`, () => {
		const projectRoot = mkdtempSync(
			path.join(tmpdir(), `lasertag-session-roots-`),
		)
		const numericInputPath = path.join(projectRoot, `NumericInput.tsx`)
		const kerningTilePath = path.join(projectRoot, `KerningTile.tsx`)
		const numericInputSource = `export function NumericInput() { return <numeric-input /> }`
		const kerningTileSource = `
			import { NumericInput } from "./NumericInput.tsx"

			export function KerningTile() {
				return <kerning-tile><NumericInput /></kerning-tile>
			}
		`

		writeFileSync(numericInputPath, numericInputSource)
		writeFileSync(kerningTilePath, kerningTileSource)

		const reusedSession = createTypescriptAstSession()

		try {
			analyzeTsxRenderStory(
				{ filePath: numericInputPath, sourceText: numericInputSource },
				reusedSession,
			)

			const reusedStory = analyzeTsxRenderStory(
				{ filePath: kerningTilePath, sourceText: kerningTileSource },
				reusedSession,
			)
			const freshStory = analyzeTsxRenderStory({
				filePath: kerningTilePath,
				sourceText: kerningTileSource,
			})

			expect(reusedStory).toEqual(freshStory)
			// One snapshot for the reused session, plus the fresh comparison.
			expect(apiLifecycle.snapshots).toBe(2)
			expect(reusedStory).toMatchObject({
				roots: [
					{
						children: [
							{
								kind: `element`,
								tagName: `numeric-input`,
							},
						],
						kind: `element`,
						tagName: `kerning-tile`,
					},
				],
			})
		} finally {
			reusedSession.close()
			rmSync(projectRoot, { force: true, recursive: true })
		}
	})

	it(`releases an unsaved overlay before importing that file from another root`, () => {
		const projectRoot = mkdtempSync(
			path.join(tmpdir(), `lasertag-session-overlay-`),
		)
		const childPath = path.join(projectRoot, `ChildPanel.tsx`)
		const parentPath = path.join(projectRoot, `ParentPanel.tsx`)
		const childSource = `export function ChildPanel() { return <disk-panel /> }`
		const parentSource = `import { ChildPanel } from "./ChildPanel.tsx"; export function ParentPanel() { return <parent-panel><ChildPanel /></parent-panel> }`
		writeFileSync(childPath, childSource)
		writeFileSync(parentPath, parentSource)
		const session = createTypescriptAstSession()
		try {
			analyzeTsxRenderStory(
				{
					filePath: childPath,
					sourceText: childSource.replace(`disk-panel`, `unsaved-panel`),
				},
				session,
			)
			const options = { filePath: parentPath, sourceText: parentSource }
			expect(analyzeTsxRenderStory(options, session)).toEqual(
				analyzeTsxRenderStory(options),
			)
		} finally {
			session.close()
			rmSync(projectRoot, { recursive: true, force: true })
		}
	})

	it(`shares one native analysis for stories and CSS evidence across files`, () => {
		using project = createCssMapperProject({
			"FirstPanel.module.css": `first-panel.class {}`,
			"SecondPanel.module.css": `second-panel.class {}`,
		})
		const session = createTypescriptAstSession({ runExternalCode: true })
		try {
			for (const name of [`FirstPanel`, `SecondPanel`, `FirstPanel`]) {
				const tag = name === `FirstPanel` ? `first-panel` : `second-panel`
				const sourceText = `import css from "./${name}.module.css"; export function ${name}() { return <${tag} class={css.class} /> }`
				const sourcePath = project.write(`${name}.tsx`, sourceText)
				const result = analyzeCssOwnershipEvidence(
					{ sourcePath, sourceText },
					session,
				)
				expect(result.renderStory.roots[0]).toMatchObject({ tagName: tag })
				expect(result.ownership).toMatchObject({
					status: `available`,
					attachments: [{ status: `sibling` }],
				})
			}
		} finally {
			session.close()
		}
		expect(apiLifecycle).toEqual({ created: 1, closed: 1, snapshots: 1 })
	})

	it(`releases missing virtual files and observes later disk creation and deletion`, () => {
		const parent = `import { ChildPanel } from "./ChildPanel.tsx"; export function ParentPanel() { return <parent-panel><ChildPanel /></parent-panel> }`
		using project = createCssMapperProject({ "ParentPanel.tsx": parent })
		const childPath = path.join(project.root, `ChildPanel.tsx`)
		const parentOptions = {
			filePath: path.join(project.root, `ParentPanel.tsx`),
			sourceText: parent,
		}
		using session = createTypescriptAstSession()
		analyzeTsxRenderStory(
			{
				filePath: childPath,
				sourceText: `export function ChildPanel() { return <unsaved-panel /> }`,
			},
			session,
		)
		expect(analyzeTsxRenderStory(parentOptions, session)).toEqual(
			analyzeTsxRenderStory(parentOptions),
		)
		project.write(
			`ChildPanel.tsx`,
			`export function ChildPanel() { return <disk-panel /> }`,
		)
		expect(analyzeTsxRenderStory(parentOptions, session)).toEqual(
			analyzeTsxRenderStory(parentOptions),
		)
		rmSync(childPath)
		expect(analyzeTsxRenderStory(parentOptions, session)).toEqual(
			analyzeTsxRenderStory(parentOptions),
		)
	})

	it(`retains separate configured projects while switching files`, () => {
		using first = createCssMapperProject()
		using second = createCssMapperProject()
		first.write(
			`tsconfig.json`,
			JSON.stringify({
				compilerOptions: { jsx: `react-jsx`, jsxImportSource: `solid-js` },
			}),
		)
		second.write(
			`tsconfig.json`,
			JSON.stringify({
				compilerOptions: { jsx: `react-jsx`, jsxImportSource: `react` },
			}),
		)
		const sourceText = `export function ProbePanel(props) { return <probe-panel {...props}>{undefined}</probe-panel> }`
		using session = createTypescriptAstSession()
		for (const project of [first, second, first]) {
			const filePath = project.write(`ProbePanel.tsx`, sourceText)
			const story = analyzeTsxRenderStory({ filePath, sourceText }, session)
			expect(
				JSON.stringify(story).includes(`spread component render props`),
			).toBe(project === first)
		}
		expect(apiLifecycle.snapshots).toBe(1)
	})

	it(`refreshes an earlier root's disk dependencies after visiting an unrelated root`, () => {
		const sourceText = `import { ChildPanel } from "./ChildPanel.tsx"; export function ParentPanel() { return <parent-panel><ChildPanel /></parent-panel> }`
		using project = createCssMapperProject({
			"ParentPanel.tsx": sourceText,
			"ChildPanel.tsx": `export function ChildPanel() { return <first-child /> }`,
			"OtherPanel.tsx": `export function OtherPanel() { return <other-panel /> }`,
		})
		using session = createTypescriptAstSession()
		const input = {
			filePath: path.join(project.root, `ParentPanel.tsx`),
			sourceText,
		}
		analyzeTsxRenderStory(input, session)
		analyzeTsxRenderStory(
			{
				filePath: path.join(project.root, `OtherPanel.tsx`),
				sourceText: `export function OtherPanel() { return <other-panel /> }`,
			},
			session,
		)
		// An unresolved query triggers a broad invalidation on the next request.
		analyzeTsxRenderStory(
			{
				filePath: path.join(project.root, `OtherPanel.tsx`),
				sourceText: `export function OtherPanel() { return <other-panel>{unboundChild}</other-panel> }`,
			},
			session,
		)
		analyzeTsxRenderStory(
			{
				filePath: path.join(project.root, `OtherPanel.tsx`),
				sourceText: `export function OtherPanel() { return <other-panel /> }`,
			},
			session,
		)
		project.write(
			`ChildPanel.tsx`,
			`export function ChildPanel() { return <second-child /> }`,
		)
		expect(analyzeTsxRenderStory(input, session)).toEqual(
			analyzeTsxRenderStory(input),
		)
	})
})
