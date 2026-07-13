import { describe, expect, it } from "vitest"

import { runLasertagFix } from "../../src/cli/fix.ts"

describe(`lasertag fix engine`, () => {
	it(`removes dead CSS using an Astro render story`, async () => {
		const cssPath = `/virtual/AppPanel.module.css`
		const sources = new Map<string, string>([
			[
				cssPath,
				`app-panel.class {
	> header {}
	> footer {}
}
`,
			],
			[
				`/virtual/AppPanel.astro`,
				`<app-panel class={css.class}><header /></app-panel>`,
			],
		])
		const result = await runLasertagFix([cssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => sources.get(filePath) ?? ``,
				writeFile: (filePath, sourceText) => sources.set(filePath, sourceText),
			},
		})

		expect(result.fixedCount).toBe(1)
		expect(result.changedFiles).toEqual([cssPath])
		expect(sources.get(cssPath)).toBe(`app-panel.class {
	> header {}

}
`)
	})

	it(`removes an unused lasertag expect-error directive`, async () => {
		const cssPath = `/virtual/AppPanel.module.css`
		const sources = new Map<string, string>([
			[
				cssPath,
				`app-panel.class {
	/* @lasertag-expect-error: header used to be conditional */
	> header {}
}
`,
			],
			[
				`/virtual/AppPanel.tsx`,
				`export function AppPanel() { return <app-panel><header /></app-panel> }
`,
			],
		])
		const result = await runLasertagFix([cssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => sources.get(filePath) ?? ``,
				writeFile: (filePath, sourceText) => sources.set(filePath, sourceText),
			},
			workerCount: 1,
		})

		expect(result.fixedCount).toBe(1)
		expect(result.remainingDiagnostics).toEqual([])
		expect(sources.get(cssPath)).toBe(`app-panel.class {
	> header {}
}
`)
	})

	it(`isolates a file failure and continues the remaining queue`, async () => {
		const brokenCssPath = `/virtual/Broken.module.css`
		const cleanCssPath = `/virtual/Clean.module.css`
		const fixableCssPath = `/virtual/Fixable.module.css`
		const sources = new Map<string, string>([
			[
				brokenCssPath,
				`broken-panel.class {
	> footer {}
}
`,
			],
			[
				`/virtual/Broken.tsx`,
				`export function Broken() { return <broken-panel /> }
`,
			],
			[
				cleanCssPath,
				`clean-panel.class {
	> header {}
}
`,
			],
			[
				`/virtual/Clean.tsx`,
				`import css from "./Clean.module.css"
export function Clean() { return <clean-panel className={css.class}><header /></clean-panel> }
`,
			],
			[
				fixableCssPath,
				`fixable-panel.class {
	> header {}
	> footer {}
}
`,
			],
			[
				`/virtual/Fixable.tsx`,
				`import css from "./Fixable.module.css"
export function Fixable() { return <fixable-panel className={css.class}><header /></fixable-panel> }
`,
			],
		])
		const writes: string[] = []
		const progress: string[] = []
		const result = await runLasertagFix(
			[brokenCssPath, cleanCssPath, fixableCssPath],
			{
				fileSystem: {
					fileExists: (filePath) => sources.has(filePath),
					readFile: (filePath) => {
						if (filePath === `/virtual/Broken.tsx`) {
							throw new Error(`training fixture read failed`)
						}

						const source = sources.get(filePath)

						if (source === undefined) throw new Error(`Missing ${filePath}`)

						return source
					},
					writeFile: (filePath, sourceText) => {
						writes.push(filePath)
						sources.set(filePath, sourceText)
					},
				},
				onProgress: ({ file }) => progress.push(file.cssPath),
				workerCount: 4,
			},
		)

		expect(result.workerCount).toBe(1)
		expect(result.fileResults.map((file) => file.cssPath)).toEqual([
			brokenCssPath,
			cleanCssPath,
			fixableCssPath,
		])
		expect(result.failures).toMatchObject([
			{
				cssPath: brokenCssPath,
				error: `training fixture read failed`,
				status: `failed`,
			},
		])
		expect(result.changedFiles).toEqual([fixableCssPath])
		expect(result.fixedCount).toBe(1)
		expect(writes).toEqual([fixableCssPath])
		expect(progress).toEqual([brokenCssPath, cleanCssPath, fixableCssPath])
		expect(sources.get(fixableCssPath)).toBe(`fixable-panel.class {
	> header {}

}
`)
	})
})
