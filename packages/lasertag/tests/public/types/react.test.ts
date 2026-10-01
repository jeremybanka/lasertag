import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, it } from "vite-plus/test"

it.each([`react`, `react-jsx`, `react-jsxdev`])(
	`types React custom roots and CSS Modules with %s`,
	(jsx) => {
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
				fileURLToPath(new URL(`fixtures/react/tsconfig.json`, import.meta.url)),
				`--jsx`,
				jsx,
			],
			{ encoding: `utf8` },
		)
		expect(result.stdout + result.stderr).toBe(``)
		expect(result.status).toBe(0)
	},
)
