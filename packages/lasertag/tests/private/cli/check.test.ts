import { describe, expect, it } from "vite-plus/test"

import { runLasertagCheck } from "../../../src/cli/check.ts"

describe(`lasertag check engine`, () => {
	it(`uses a same-named Astro file as the render story neighbor`, async () => {
		const cssPath = `/virtual/AppPanel.module.css`
		const astroPath = `/virtual/AppPanel.astro`
		const sources = new Map<string, string>([
			[
				cssPath,
				`app-panel.class {
	> footer {}
}`,
			],
			[astroPath, `<app-panel class={css.class}><header /></app-panel>`],
		])
		const result = await runLasertagCheck([cssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => sources.get(filePath) ?? ``,
			},
		})

		expect(result.failures).toEqual([])
		expect(result.fileResults).toMatchObject([
			{ status: `checked`, tsxPath: astroPath },
		])
		expect(result.diagnostics).toMatchObject([
			{ diagnostic: { code: `dead-selector` }, tsxPath: astroPath },
		])
	})

	it(`fails loudly when both Astro and TSX neighbors exist`, async () => {
		const cssPath = `/virtual/AppPanel.module.css`
		const sources = new Map<string, string>([
			[cssPath, `app-panel.class {}`],
			[`/virtual/AppPanel.astro`, `<app-panel />`],
			[`/virtual/AppPanel.tsx`, `export const AppPanel = () => <app-panel />`],
		])
		const result = await runLasertagCheck([cssPath], {
			fileSystem: {
				fileExists: (filePath) => sources.has(filePath),
				readFile: (filePath) => sources.get(filePath) ?? ``,
			},
		})

		expect(result.failures).toHaveLength(1)
		expect(result.failures[0]).toMatchObject({ status: `failed` })
		expect(result.failures[0]?.error).toContain(`Ambiguous render story`)
		expect(result.failures[0]?.error).toContain(`/virtual/AppPanel.tsx`)
		expect(result.failures[0]?.error).toContain(`/virtual/AppPanel.astro`)
	})

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
			workerModuleUrl: new URL(`../../../src/cli/main.ts`, import.meta.url),
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
