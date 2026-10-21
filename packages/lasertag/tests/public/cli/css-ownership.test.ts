import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { expect, it } from "vite-plus/test"

import { createCssMapperProject } from "../lsp/fixtures/css-project.ts"

const source = `import css from "./AppPanel.module.css"; export const AppPanel = () => <app-panel className={css.class}><span /></app-panel>`
const css = `app-panel.class { > span {} > missing {} }\n.extra {}`
const entry =
	process.env.LASERTAG_TEST_CLI_ENTRY ??
	fileURLToPath(new URL(`../../../src/cli/main.ts`, import.meta.url))
async function cli(cwd: string, args: string[]) {
	try {
		return {
			...(await promisify(execFile)(process.execPath, [entry, ...args], {
				cwd,
				timeout: 15_000,
			})),
			code: 0,
		}
	} catch (error) {
		const failure = error as { code: number; stdout: string; stderr: string }
		if (failure.code !== 1) throw error
		return failure
	}
}

async function ordinaryCli(
	project: ReturnType<typeof createCssMapperProject>,
	args: string[],
) {
	const configPath = `${project.root}/tsconfig.json`
	const original = readFileSync(configPath, `utf8`)
	const config = JSON.parse(original)
	delete config.contentMappers
	project.write(`tsconfig.json`, JSON.stringify(config))
	try {
		return await cli(project.root, args)
	} finally {
		project.write(`tsconfig.json`, original)
	}
}

it.each([`tsx`, `astro`])(
	`ships CSS evidence through check for %s while preserving diagnostics`,
	async (extension) => {
		using project = createCssMapperProject({
			[`AppPanel.${extension}`]:
				extension === `tsx`
					? source
					: `---\nimport css from "./AppPanel.module.css"\n---\n<app-panel class={css.class}><span /></app-panel>`,
			"AppPanel.module.css": css,
		})
		const ordinary = await ordinaryCli(project, [`check`, `--format=json`])
		const mapped = await cli(project.root, [`check`, `--format=json`])
		const { ownership, ...output } = JSON.parse(mapped.stdout)
		expect(output).toEqual(JSON.parse(ordinary.stdout))
		expect(mapped.code).toBe(ordinary.code)
		expect(ownership).toHaveLength(1)
		expect(ownership[0]).toMatchObject({
			status: `available`,
			attachments: [{ expression: `css.class`, status: `sibling` }],
		})
		const target = ownership[0].attachments[0].targets[0]
		expect(
			readFileSync(target.sourcePath, `utf8`).slice(
				target.range.start,
				target.range.end,
			),
		).toBe(`class`)
	},
)

it(
	`reports foreign stylesheet ownership without changing class-only diagnostics or fix output`,
	{ timeout: 20_000 },
	async () => {
		using project = createCssMapperProject({
			"AppPanel.tsx": source.replace(
				`./AppPanel.module.css`,
				`./Other.module.css`,
			),
			"AppPanel.module.css": css,
			"Other.module.css": `.class {}`,
		})
		const result = JSON.parse(
			(await cli(project.root, [`check`, `--format=json`])).stdout,
		)
		expect(result.ownership[0].attachments[0].status).toBe(`foreign`)
		const ordinary = await ordinaryCli(project, [`fix`])
		const expected = readFileSync(`${project.root}/AppPanel.module.css`, `utf8`)
		project.write(`AppPanel.module.css`, css)
		const mapped = await cli(project.root, [`fix`])
		expect(mapped.code).toBe(ordinary.code)
		expect(readFileSync(`${project.root}/AppPanel.module.css`, `utf8`)).toBe(
			expected,
		)
		expect(mapped.stdout).toContain(`css.class: foreign`)
	},
)

it(`keeps ordinary check and fix usable with no configured CSS mapper`, async () => {
	using project = createCssMapperProject(
		{ "AppPanel.tsx": source, "AppPanel.module.css": css },
		false,
	)
	const ordinary = JSON.parse(
		(await ordinaryCli(project, [`check`, `--format=json`])).stdout,
	)
	const { ownership, ...mapped } = JSON.parse(
		(await cli(project.root, [`check`, `--format=json`])).stdout,
	)
	expect(mapped).toEqual(ordinary)
	expect(ownership).toBeUndefined()
})

it(`preserves check diagnostics when the configured CSS mapper crashes`, async () => {
	using project = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
	})
	const script = project.write(`broken/entry.ts`, `process.exit(1)`)
	project.write(
		`broken/package.json`,
		JSON.stringify({
			name: `broken-mapper`,
			version: `1.0.0`,
			typescript: {
				contentMapper: {
					exec: [process.execPath, script],
					compilerOptions: [],
				},
			},
		}),
	)
	project.write(
		`tsconfig.json`,
		JSON.stringify({
			contentMappers: [
				{ package: `${project.root}/broken`, extensions: [`.module.css`] },
			],
		}),
	)
	const ordinary = JSON.parse(
		(await ordinaryCli(project, [`check`, `--format=json`])).stdout,
	)
	const { ownership, ...mapped } = JSON.parse(
		(await cli(project.root, [`check`, `--format=json`])).stdout,
	)
	expect(mapped).toEqual(ordinary)
	expect(ownership).toBeUndefined()
})
