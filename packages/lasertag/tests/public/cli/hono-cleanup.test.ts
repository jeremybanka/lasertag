import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vite-plus/test"

import { runLasertagCli } from "../../../src/cli/main.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { honoCleanupCases } from "../fixtures/hono.ts"

it.each(honoCleanupCases)(
	`CLI fix preserves Hono CSS: $name`,
	async ({ source }) => {
		const root = mkdtempSync(path.join(tmpdir(), `lasertag-hono-cleanup-`))
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
			expect(result.fixedCount).toBe(0)
			expect(result.changedFiles).toEqual([])
			expect(result.exitCode).toBe(result.diagnostics.length > 0 ? 1 : 0)
			expect(messages.join(`\n`)).not.toMatch(
				/failed|skipped|no render source/i,
			)
			expect(readFileSync(cssPath, `utf8`)).toBe(conservativeJsxCss)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
)
