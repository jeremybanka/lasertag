import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runLasertagCli } from "../../src/cli/main.ts"

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

	it(`prints top-level help when no command is passed`, async () => {
		const { io, logs } = createTestIO()
		const result = await runLasertagCli([`lasertag`], io)

		expect(result.mode).toBe(`help`)
		expect(result.exitCode).toBe(0)
		expect(logs[0]).toContain(`USAGE`)
		expect(logs[0]).toContain(`check`)
		expect(logs[0]).toContain(`fix`)
		expect(logs[0]).toContain(`vsix`)
	})

	it(`prints help when --help or -h is passed`, async () => {
		const helpLong = createTestIO()
		const helpShort = createTestIO()
		const longResult = await runLasertagCli([`lasertag`, `--help`], helpLong.io)
		const shortResult = await runLasertagCli([`lasertag`, `-h`], helpShort.io)

		expect(longResult.mode).toBe(`help`)
		expect(shortResult.mode).toBe(`help`)
		expect(helpLong.logs[0]).toContain(`USAGE`)
		expect(helpShort.logs[0]).toContain(`USAGE`)
	})

	it(`prints the package version when --version or -v is passed`, async () => {
		const versionLong = createTestIO()
		const versionShort = createTestIO()
		const longResult = await runLasertagCli(
			[`lasertag`, `--version`],
			versionLong.io,
			{
				packageVersion: `1.2.3-test`,
			},
		)
		const shortResult = await runLasertagCli(
			[`lasertag`, `-v`],
			versionShort.io,
			{
				packageVersion: `1.2.3-test`,
			},
		)

		expect(longResult.mode).toBe(`version`)
		expect(shortResult.mode).toBe(`version`)
		expect(versionLong.logs).toEqual([`1.2.3-test`])
		expect(versionShort.logs).toEqual([`1.2.3-test`])
	})

	it(`checks default css module globs`, async () => {
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
		const result = await runLasertagCli([`lasertag`, `check`], io, {
			cwd: fixture.root,
		})

		expect(result.mode).toBe(`check`)
		expect(result.targets).toEqual([`**/*.module.css`])
		expect(result.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(result.diagnostics).toEqual([])
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag check: no dead CSS found in 1 file.`])
	})

	it(`reports diagnostics for a single positional check glob`, async () => {
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
		const result = await runLasertagCli(
			[`lasertag`, `check`, `src/**/*.module.css`],
			io,
			{
				cwd: fixture.root,
			},
		)

		expect(result.mode).toBe(`check`)
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

	it(`accepts comma-separated patterns in the single positional check glob`, async () => {
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
			"test/TestPanel.module.css": `
				test-panel.class {
					> footer {}
				}
			`,
			"test/TestPanel.tsx": `
				import css from "./TestPanel.module.css"

				export function TestPanel() {
					return <test-panel className={css.class} />
				}
			`,
		})
		const { io } = createTestIO()
		const result = await runLasertagCli(
			[`lasertag`, `check`, `src/**/*.module.css,test/**/*.module.css`],
			io,
			{
				cwd: fixture.root,
			},
		)

		expect(result.targets).toEqual([
			`src/**/*.module.css`,
			`test/**/*.module.css`,
		])
		expect(result.files).toEqual([
			fixture.path(`src/AppPanel.module.css`),
			fixture.path(`test/TestPanel.module.css`),
		])
		expect(result.diagnostics).toHaveLength(1)
		expect(result.exitCode).toBe(1)
	})

	it(`accepts one css module file path as the positional check glob`, async () => {
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
		const result = await runLasertagCli([`lasertag`, `check`, cssPath], io, {
			cwd: fixture.root,
		})

		expect(result.targets).toEqual([cssPath])
		expect(result.files).toEqual([cssPath])
		expect(result.diagnostics).toHaveLength(1)
		expect(result.exitCode).toBe(1)
	})

	it(`rejects multiple positional check glob values`, async () => {
		const { io } = createTestIO()

		await expect(
			runLasertagCli(
				[`lasertag`, `check`, `src/**/*.module.css`, `test/**/*.module.css`],
				io,
			),
		).rejects.toThrow(`There are no positional arguments for lasertag`)
	})

	it(`prints json diagnostics when check --format=json is passed`, async () => {
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
		const result = await runLasertagCli(
			[`lasertag`, `check`, `--format=json`, `src/**/*.module.css`],
			io,
			{ cwd: fixture.root },
		)
		const output = JSON.parse(logs[0] ?? ``) as {
			diagnostics: Array<{ code: string; selector: string }>
			files: string[]
		}

		expect(result.options).toMatchObject({ format: `json` })
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(output.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(output.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > footer`,
			},
		])
	})

	it(`runs the fix stub under the fix command`, async () => {
		const { io, logs } = createTestIO()
		const result = await runLasertagCli(
			[`lasertag`, `fix`, `src/**/*.module.css`],
			io,
		)

		expect(result.mode).toBe(`fix`)
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag fix: dead CSS cleanup is stubbed.`])
	})

	it(`checks with an explicit TypeScript SDK executable path`, async () => {
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
		const result = await runLasertagCli([`lasertag`, `check`], io, {
			cwd: fixture.root,
			typescriptSdkPath: resolveTypescriptExecutable(),
		})

		expect(result.mode).toBe(`check`)
		expect(result.exitCode).toBe(0)
		expect(logs).toEqual([`lasertag check: no dead CSS found in 1 file.`])
	})

	it(`builds and installs a VSIX with default options`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `1.0.0` }),
		})
		const { io, logs } = createTestIO()
		const buildRequests: Array<{ outdir: string; packageRoot: string }> = []
		const installRequests: Array<{
			editorCommand: string
			vsixPath: string
		}> = []
		const result = await runLasertagCli([`lasertag`, `vsix`], io, {
			cwd: fixture.root,
			buildVsix: async (request) => {
				buildRequests.push({
					outdir: request.outdir,
					packageRoot: request.packageRoot ?? ``,
				})
				return {
					buildRoot: fixture.path(`dist/.lasertag-vsix`),
					vscodeTarget: `linux-x64`,
					vsixPath: fixture.path(`dist/Lasertag.vsix`),
				}
			},
			installVscodeExtension: (request) => {
				installRequests.push({
					editorCommand: request.editorCommand,
					vsixPath: request.vsixPath,
				})
				return { exitCode: 0 }
			},
			packageRoot: fixture.root,
		})

		expect(result.mode).toBe(`vsix`)
		expect(result.exitCode).toBe(0)
		expect(buildRequests).toEqual([
			{
				outdir: fixture.path(`dist`),
				packageRoot: fixture.root,
			},
		])
		expect(installRequests).toEqual([
			{
				editorCommand: `code`,
				vsixPath: fixture.path(`dist/Lasertag.vsix`),
			},
		])
		expect(logs).toEqual([
			`lasertag vsix: installed ${fixture.path(`dist/Lasertag.vsix`)} with code.`,
		])
	})

	it(`builds and installs a VSIX with explicit outdir and target`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `1.0.0` }),
		})
		const { io } = createTestIO()
		const buildRequests: Array<{ outdir: string }> = []
		const installRequests: Array<{ editorCommand: string }> = []
		const result = await runLasertagCli(
			[`lasertag`, `vsix`, `-o`, `tmp/vsix`, `-t`, `code-insiders`],
			io,
			{
				buildVsix: async (request) => {
					buildRequests.push({ outdir: request.outdir })
					return {
						buildRoot: fixture.path(`tmp/vsix/.lasertag-vsix`),
						vscodeTarget: `linux-x64`,
						vsixPath: fixture.path(`tmp/vsix/Lasertag.vsix`),
					}
				},
				installVscodeExtension: (request) => {
					installRequests.push({ editorCommand: request.editorCommand })
					return { exitCode: 0 }
				},
				packageRoot: fixture.root,
			},
		)

		expect(result.mode).toBe(`vsix`)
		expect(result.options).toMatchObject({
			outdir: `tmp/vsix`,
			target: `code-insiders`,
		})
		expect(buildRequests).toEqual([{ outdir: fixture.path(`tmp/vsix`) }])
		expect(installRequests).toEqual([{ editorCommand: `code-insiders` }])
	})

	it(`builds a VSIX without installing when --build-only is passed`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `1.0.0` }),
		})
		const { io, logs } = createTestIO()
		let installed = false
		const result = await runLasertagCli(
			[`lasertag`, `vsix`, `--build-only`, `--outdir`, `tmp/vsix`],
			io,
			{
				buildVsix: async () => ({
					buildRoot: fixture.path(`tmp/vsix/.lasertag-vsix`),
					vscodeTarget: `linux-x64`,
					vsixPath: fixture.path(`tmp/vsix/Lasertag.vsix`),
				}),
				installVscodeExtension: () => {
					installed = true
					return { exitCode: 0 }
				},
				packageRoot: fixture.root,
			},
		)

		expect(result.mode).toBe(`vsix`)
		expect(result.exitCode).toBe(0)
		expect(result.options).toMatchObject({ "build-only": true })
		expect(installed).toBe(false)
		expect(logs).toEqual([
			`lasertag vsix: built ${fixture.path(`tmp/vsix/Lasertag.vsix`)}.`,
		])
	})

	it(`reports VSIX installer failures`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `1.0.0` }),
		})
		const { errors, io } = createTestIO()
		const result = await runLasertagCli([`lasertag`, `vsix`], io, {
			buildVsix: async () => ({
				buildRoot: fixture.path(`dist/.lasertag-vsix`),
				vscodeTarget: `linux-x64`,
				vsixPath: fixture.path(`dist/Lasertag.vsix`),
			}),
			installVscodeExtension: () => ({
				error: `code was not found on PATH.`,
				exitCode: 1,
			}),
			packageRoot: fixture.root,
		})

		expect(result.mode).toBe(`vsix`)
		expect(result.exitCode).toBe(1)
		expect(errors).toEqual([`lasertag vsix: code was not found on PATH.`])
	})
})
