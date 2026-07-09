import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runLasertagCli } from "../src/main.ts"

const requireFromTest = createRequire(import.meta.url)
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

function resolveTypescriptExecutable(): string {
	const typescriptPackageJsonPath = requireFromTest.resolve(
		`typescript/package.json`,
	)
	const requireFromTypescript = createRequire(typescriptPackageJsonPath)
	const nativePackageJsonPath = requireFromTypescript.resolve(
		`@typescript/typescript-${process.platform}-${process.arch}/package.json`,
	)
	const executableName = process.platform === `win32` ? `tsc.exe` : `tsc`

	return path.join(path.dirname(nativePackageJsonPath), `lib`, executableName)
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

	it(`validates with an explicit TypeScript SDK executable path`, () => {
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
		const result = runLasertagCli([`lasertag`], io, {
			cwd: fixture.root,
			typescriptSdkPath: resolveTypescriptExecutable(),
		})

		expect(result.mode).toBe(`validate`)
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag validate: no dead CSS found in 1 file.`])
	})

	it(`installs the bundled VSCode extension when --vscode-install is passed`, () => {
		const fixture = createFixture({
			"dist/Lasertag.vsix": `fake vsix`,
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
		const requests: Array<{
			cwd: string
			editorCommand: string
			vsixPath: string
		}> = []
		const result = runLasertagCli(
			[`lasertag`, `--vscode-install`, `code-insiders`],
			io,
			{
				cwd: fixture.root,
				installVscodeExtension: (request) => {
					requests.push(request)
					return { exitCode: 0 }
				},
				vsixPath: fixture.path(`dist/Lasertag.vsix`),
			},
		)

		expect(result.mode).toBe(`vscode-install`)
		expect(result.options[`vscode-install`]).toBe(`code-insiders`)
		expect(result.targets).toEqual([`**/*.module.css`])
		expect(result.diagnostics).toEqual([])
		expect(result.files).toEqual([])
		expect(result.exitCode).toBe(0)
		expect(requests).toEqual([
			{
				cwd: fixture.root,
				editorCommand: `code-insiders`,
				vsixPath: fixture.path(`dist/Lasertag.vsix`),
			},
		])
		expect(logs).toEqual([
			`lasertag vscode: installed Lasertag with code-insiders.`,
		])
	})

	it(`defaults the VSCode extension installer to code`, () => {
		const fixture = createFixture({
			"dist/Lasertag.vsix": `fake vsix`,
		})
		const { io, logs } = createTestIO()
		const requests: Array<{
			editorCommand: string
		}> = []
		const result = runLasertagCli([`lasertag`, `--vscode-install`], io, {
			cwd: fixture.root,
			installVscodeExtension: (request) => {
				requests.push({ editorCommand: request.editorCommand })
				return { exitCode: 0 }
			},
			vsixPath: fixture.path(`dist/Lasertag.vsix`),
		})

		expect(result.mode).toBe(`vscode-install`)
		expect(result.options[`vscode-install`]).toBe(``)
		expect(result.exitCode).toBe(0)
		expect(requests).toEqual([{ editorCommand: `code` }])
		expect(logs).toEqual([`lasertag vscode: installed Lasertag with code.`])
	})

	it(`reports a missing bundled VSCode extension`, () => {
		const fixture = createFixture({})
		const { errors, io } = createTestIO()
		let installed = false
		const result = runLasertagCli([`lasertag`, `--vscode-install`], io, {
			cwd: fixture.root,
			installVscodeExtension: () => {
				installed = true
				return { exitCode: 0 }
			},
			vsixPath: fixture.path(`dist/Lasertag.vsix`),
		})

		expect(result.mode).toBe(`vscode-install`)
		expect(result.exitCode).toBe(1)
		expect(installed).toBe(false)
		expect(errors[0]).toContain(`bundled extension not found`)
		expect(errors[0]).toContain(fixture.path(`dist/Lasertag.vsix`))
	})

	it(`reports VSCode extension installer failures`, () => {
		const fixture = createFixture({
			"dist/Lasertag.vsix": `fake vsix`,
		})
		const { errors, io } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--vscode-install`], io, {
			cwd: fixture.root,
			installVscodeExtension: () => ({
				error: `code was not found on PATH.`,
				exitCode: 1,
			}),
			vsixPath: fixture.path(`dist/Lasertag.vsix`),
		})

		expect(result.mode).toBe(`vscode-install`)
		expect(result.exitCode).toBe(1)
		expect(errors).toEqual([`lasertag vscode: code was not found on PATH.`])
	})

	it(`prints help when --help is passed`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--help`], io)

		expect(result.mode).toBe(`help`)
		expect(logs[0]).toContain(`USAGE`)
		expect(logs[0]).toContain(`--fix`)
		expect(logs[0]).toContain(`--format`)
		expect(logs[0]).toContain(`--vscode-install`)
	})
})
