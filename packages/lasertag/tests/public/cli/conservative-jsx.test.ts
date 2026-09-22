import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, it } from "vite-plus/test"

import { runLasertagCli } from "../../../src/cli/main.ts"
import {
	conservativeJsxCases,
	conservativeJsxCss,
} from "../fixtures/conservative-jsx.ts"

it.each(conservativeJsxCases)(
	`CLI fix preserves live CSS for $name`,
	async ({ source }) => {
		const root = mkdtempSync(path.join(tmpdir(), `lasertag-conservative-`))
		try {
			const cssPath = path.join(root, `AppPanel.module.css`)
			writeFileSync(path.join(root, `AppPanel.tsx`), source)
			writeFileSync(cssPath, conservativeJsxCss)
			await runLasertagCli(
				[`node`, `lasertag`, `fix`],
				{ log() {}, error() {} },
				{ cwd: root },
			)
			expect(readFileSync(cssPath, `utf8`)).toBe(conservativeJsxCss)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
)
