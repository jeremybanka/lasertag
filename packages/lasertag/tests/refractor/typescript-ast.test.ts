import { beforeEach, describe, expect, it, vi } from "vitest"

const apiLifecycle = vi.hoisted(() => ({ closed: 0, created: 0 }))

vi.mock(`typescript/unstable/sync`, async (importOriginal) => {
	const typescript =
		await importOriginal<typeof import("typescript/unstable/sync")>()

	return {
		...typescript,
		API: class extends typescript.API {
			constructor(options?: ConstructorParameters<typeof typescript.API>[0]) {
				super(options)
				apiLifecycle.created += 1
			}

			override close() {
				apiLifecycle.closed += 1
				super.close()
			}
		},
	}
})

import { analyzeTsxRenderStory } from "../../src/refractor/analyze-tsx.ts"
import { createTypescriptAstSession } from "../../src/refractor/typescript-ast.ts"
import { runLasertagCheck } from "../../src/cli/check.ts"

describe(`TypeScript AST session`, () => {
	beforeEach(() => {
		apiLifecycle.closed = 0
		apiLifecycle.created = 0
	})

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
		expect(apiLifecycle).toEqual({ closed: 1, created: 1 })
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
		expect(apiLifecycle).toEqual({ closed: 1, created: 1 })
	})
})
