import { spawnSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, it } from "vite-plus/test"

const requireFromTest = createRequire(import.meta.url)
const packageJsonPath = requireFromTest.resolve(`../../../package.json`)
const packageRoot = path.dirname(packageJsonPath)
const packageVersion = (
	JSON.parse(readFileSync(packageJsonPath, `utf8`)) as { version: string }
).version

it(`runs through a symlinked package path`, () => {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-cli-symlink-`))
	const linkedPackageRoot = path.join(root, `node_modules`, `lasertag`)

	try {
		mkdirSync(path.dirname(linkedPackageRoot), { recursive: true })
		symlinkSync(
			packageRoot,
			linkedPackageRoot,
			process.platform === `win32` ? `junction` : `dir`,
		)

		const result = spawnSync(
			process.execPath,
			[path.join(linkedPackageRoot, `src`, `cli`, `main.ts`), `--version`],
			{ encoding: `utf8` },
		)

		expect(result.status).toBe(0)
		expect(result.stderr).toBe(``)
		expect(result.stdout).toBe(`${packageVersion}\n`)
	} finally {
		rmSync(root, { force: true, recursive: true })
	}
})
