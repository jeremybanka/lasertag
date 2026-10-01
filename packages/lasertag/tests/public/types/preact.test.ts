import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, it } from "vite-plus/test"

it.each(
	([`preact`, `preact/compat`] as const).flatMap((runtime) =>
		([`react-jsx`, `react-jsxdev`] as const).map((jsx) => ({
			name: `${runtime} ${jsx}`,
			options: [`--jsx`, jsx, `--jsxImportSource`, runtime],
		})),
	),
)(`types Preact custom roots and CSS Modules with $name`, ({ options }) => {
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
			fileURLToPath(new URL(`fixtures/preact/tsconfig.json`, import.meta.url)),
			...options,
		],
		{ encoding: `utf8` },
	)
	expect(result.stdout + result.stderr).toBe(``)
	expect(result.status).toBe(0)
})
