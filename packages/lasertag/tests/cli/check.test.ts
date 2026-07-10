import { describe, expect, it } from "vitest"

import { runLasertagCheck } from "../../src/cli/check.ts"

describe(`lasertag check engine`, () => {
	it(`uses the serial fallback for an injected file system`, async () => {
		const warningCssPath = `/virtual/Warning.module.css`
		const cleanCssPath = `/virtual/Clean.module.css`
		const sources = new Map<string, string>([
			[
				warningCssPath,
				`warning-panel.class {
	> footer {}
}
`,
			],
			[
				`/virtual/Warning.tsx`,
				`import css from "./Warning.module.css"
export function Warning() { return <warning-panel className={css.class}><header /></warning-panel> }
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
		])
		const result = await runLasertagCheck([warningCssPath, cleanCssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => {
					const source = sources.get(filePath)

					if (source === undefined) throw new Error(`Missing ${filePath}`)

					return source
				},
			},
			workerCount: 4,
			workerModuleUrl: new URL(`../../src/cli/main.ts`, import.meta.url),
		})

		expect(result.workerCount).toBe(1)
		expect(result.stealCount).toBe(0)
		expect(result.failures).toEqual([])
		expect(result.fileResults.map((file) => file.cssPath)).toEqual([
			warningCssPath,
			cleanCssPath,
		])
		expect(result.diagnostics).toMatchObject([
			{
				cssPath: warningCssPath,
				diagnostic: { code: `dead-selector` },
			},
		])
	})
})
