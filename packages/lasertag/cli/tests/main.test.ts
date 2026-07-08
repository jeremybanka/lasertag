import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runLasertagCli } from "../src/main.ts"

const fixtureRoots: string[] = []

function createTestIO() {
	const logs: string[] = []
	const errors: string[] = []

	return {
		errors,
		io: {
			error: (message: string) => errors.push(message),
			log: (message: string) => logs.push(message),
		},
		logs,
	}
}

function createFixture(files: Record<string, string>) {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-cli-`))

	fixtureRoots.push(root)

	for (const [filePath, sourceText] of Object.entries(files)) {
		const absolutePath = path.join(root, filePath)

		mkdirSync(path.dirname(absolutePath), { recursive: true })
		writeFileSync(absolutePath, sourceText)
	}

	return {
		path: (filePath: string) => path.join(root, filePath),
		root,
	}
}

describe(`lasertag cli`, () => {
	afterEach(() => {
		for (const root of fixtureRoots.splice(0)) {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it(`validates css modules by default`, () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `
				app-panel.class {
					> header {}
				}
			`,
			"src/AppPanel.tsx": `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<header />
						</app-panel>
					)
				}
			`,
		})
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`], io, { cwd: fixture.root })

		expect(result.mode).toBe(`validate`)
		expect(result.options.fix).toBe(false)
		expect(result.targets).toEqual([`**/*.module.css`])
		expect(result.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(result.diagnostics).toEqual([])
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag validate: no dead CSS found in 1 file.`])
	})

	it(`reports diagnostics for a positional glob`, () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `
				app-panel.class {
					> footer {}
				}
			`,
			"src/AppPanel.tsx": `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<header />
						</app-panel>
					)
				}
			`,
			"test/Ignored.module.css": `
				ignored-panel.class {}
			`,
		})
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`, `src/**/*.module.css`], io, {
			cwd: fixture.root,
		})

		expect(result.mode).toBe(`validate`)
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(result.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				cssPath: fixture.path(`src/AppPanel.module.css`),
				selector: `app-panel.class > footer`,
			},
		])
		expect(result.exitCode).toBe(1)
		expect(logs[0]).toContain(`src/AppPanel.module.css:3:6`)
		expect(logs[0]).toContain(`dead-selector`)
		expect(logs[0]).toContain(`app-panel.class > footer`)
	})

	it(`accepts shell-expanded css module file paths`, () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `
				app-panel.class {
					> footer {}
				}
			`,
			"src/AppPanel.tsx": `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return <app-panel className={css.class} />
				}
			`,
		})
		const { io } = createTestIO()
		const cssPath = fixture.path(`src/AppPanel.module.css`)
		const result = runLasertagCli([`lasertag`, cssPath], io, {
			cwd: fixture.root,
		})

		expect(result.targets).toEqual([cssPath])
		expect(result.files).toEqual([cssPath])
		expect(result.diagnostics).toHaveLength(1)
		expect(result.exitCode).toBe(1)
	})

	it(`prints json diagnostics when --format=json is passed`, () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `
				app-panel.class {
					> footer {}
				}
			`,
			"src/AppPanel.tsx": `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return <app-panel className={css.class} />
				}
			`,
		})
		const { io, logs } = createTestIO()
		const result = runLasertagCli(
			[`lasertag`, `--format=json`, `--`, `src/**/*.module.css`],
			io,
			{ cwd: fixture.root },
		)
		const output = JSON.parse(logs[0] ?? ``) as {
			diagnostics: Array<{ code: string; selector: string }>
			files: string[]
		}

		expect(result.options.format).toBe(`json`)
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(output.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(output.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > footer`,
			},
		])
	})

	it(`runs the fix stub when --fix is passed`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli(
			[`lasertag`, `--fix`, `src/**/*.module.css`],
			io,
		)

		expect(result.mode).toBe(`fix`)
		expect(result.options.fix).toBe(true)
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag fix: dead CSS cleanup is stubbed.`])
	})

	it(`keeps validate mode when --fix=false is passed`, () => {
		const fixture = createFixture({})
		const { io } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--fix=false`], io, {
			cwd: fixture.root,
		})

		expect(result.mode).toBe(`validate`)
		expect(result.options.fix).toBe(false)
		expect(result.exitCode).toBe(0)
	})

	it(`prints help when --help is passed`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--help`], io)

		expect(result.mode).toBe(`help`)
		expect(logs[0]).toContain(`USAGE`)
		expect(logs[0]).toContain(`--fix`)
		expect(logs[0]).toContain(`--format`)
	})
})
