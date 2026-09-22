import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, it } from "vite-plus/test"

it.each([`hono/jsx`, `hono/jsx/dom`])(
	`types %s custom roots and CSS Modules without React globals`,
	(runtime) => {
		const require = createRequire(import.meta.url)
		const compiler = path.join(
			path.dirname(require.resolve(`typescript/package.json`)),
			`bin/tsc`,
		)
		const result = spawnSync(
			process.execPath,
			[
				compiler,
				`--project`,
				fileURLToPath(new URL(`fixtures/hono/tsconfig.json`, import.meta.url)),
				`--jsxImportSource`,
				runtime,
			],
			{ encoding: `utf8` },
		)
		expect(result.stdout + result.stderr).toBe(``)
		expect(result.status).toBe(0)
	},
)
