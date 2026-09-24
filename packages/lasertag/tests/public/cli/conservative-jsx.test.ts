import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, it } from "vite-plus/test"

import { runLasertagCli } from "../../../src/cli/main.ts"
import {
	conservativeJsxCases,
	conservativeJsxCss,
} from "../fixtures/conservative-jsx.ts"
import { solidPropPrecedenceCases } from "../fixtures/solid-prop-precedence.ts"
import { solidSwitchCases } from "../fixtures/solid-switch.ts"

it.each<{
	name: string
	source: string
	preserve: boolean
	diagnosticCodes?: string[]
}>([
	...solidSwitchCases.map((testCase) => ({
		...testCase,
		preserve: testCase.rendersAside,
	})),
	...conservativeJsxCases.map((testCase) => ({ ...testCase, preserve: true })),
	...solidPropPrecedenceCases
		.filter(({ rendersAside }) => !rendersAside)
		.map((testCase) => ({ ...testCase, preserve: false })),
])(
	`CLI fix respects rendered children for $name`,
	async ({ source, preserve, diagnosticCodes }) => {
		const root = mkdtempSync(path.join(tmpdir(), `lasertag-conservative-`))
		try {
			const messages: string[] = []
			const cssPath = path.join(root, `AppPanel.module.css`)
			writeFileSync(path.join(root, `AppPanel.tsx`), source)
			writeFileSync(cssPath, conservativeJsxCss)
			const result = await runLasertagCli(
				[`node`, `lasertag`, `fix`],
				{
					log(message) {
						messages.push(message)
					},
					error(message) {
						messages.push(message)
					},
				},
				{ cwd: root },
			)
			expect(result.mode).toBe(`fix`)
			expect(result.files).toEqual([cssPath])
			expect(result.fixedCount).toBe(preserve ? 0 : 1)
			expect(result.changedFiles).toEqual(preserve ? [] : [cssPath])
			expect(result.exitCode).toBe(result.diagnostics.length > 0 ? 1 : 0)
			if (diagnosticCodes) {
				// Fix mode reports diagnostics remaining after its successful edits.
				expect(result.diagnostics.map(({ code }) => code)).toEqual(
					diagnosticCodes.filter((code) => code !== `dead-selector`),
				)
			}
			expect(messages.join(`\n`)).not.toMatch(
				/failed|skipped|no render source/i,
			)
			const fixedCss = readFileSync(cssPath, `utf8`)
			if (preserve) expect(fixedCss).toBe(conservativeJsxCss)
			else expect(fixedCss).not.toContain(`> aside`)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
)
