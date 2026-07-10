import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runLasertagCli } from "../../src/cli/main.ts"
import { createFixCourse } from "./fix-course.ts"

const requireFromTest = createRequire(import.meta.url)
const fixtureRoots: string[] = []
const TRAINING_COURSE_OUTPUT =
	process.env.LASERTAG_TRAINING_COURSE_OUTPUT ??
	process.env.LASERTAG_FIX_COURSE_CHRONICLE
const SHOW_TRAINING_COURSE_OUTPUT =
	TRAINING_COURSE_OUTPUT === `1` ||
	(!process.env.CI && TRAINING_COURSE_OUTPUT !== `0`)

function createTestIO({ echo = false }: { echo?: boolean } = {}) {
	const logs: string[] = []
	const errors: string[] = []

	return {
		errors,
		io: {
			error: (message: string) => {
				errors.push(message)
				if (echo) process.stderr.write(`${message}\n`)
			},
			log: (message: string) => {
				logs.push(message)
				if (echo) process.stdout.write(`${message}\n`)
			},
		},
		logs,
	}
}

function showTrainingCourseStage(stage: string, lessonCount: number): void {
	if (!SHOW_TRAINING_COURSE_OUTPUT) return

	process.stdout.write(
		`\n[training course] ${stage} — ${lessonCount} lessons\n\n`,
	)
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

	it(`shows concise warning regions from the generated training course`, async () => {
		const course = createFixCourse()
		const fixture = createFixture(course.files)
		const output = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })
		const expectedWarningCount = course.lessons.reduce(
			(count, lesson) => count + lesson.expectedRemovedSelectors.length,
			0,
		)

		showTrainingCourseStage(`check warning regions`, course.lessons.length)

		const result = await runLasertagCli(
			[`lasertag`, `check`, `course/**/*.module.css`],
			output.io,
			{ cwd: fixture.root },
		)
		const warningBlocks = (output.logs[0] ?? ``).split(/\n\n+/).filter(Boolean)

		expect(output.errors).toEqual([])
		expect(result.mode).toBe(`check`)
		expect(result.exitCode).toBe(1)
		expect(result.diagnostics).toHaveLength(expectedWarningCount)
		expect(warningBlocks).toHaveLength(result.diagnostics.length)

		for (const [index, diagnostic] of result.diagnostics.entries()) {
			const block = warningBlocks[index]
			const relativeCssPath = path.relative(fixture.root, diagnostic.cssPath)
			const cssSource = course.files[relativeCssPath]

			if (!block || !cssSource || !diagnostic.range) {
				throw new Error(
					`Course warning ${index + 1} is missing source context.`,
				)
			}

			const warningRegion = cssSource
				.slice(diagnostic.range.start, diagnostic.range.end)
				.replaceAll(`\t`, `    `)
				.trim()

			expect(block).toContain(diagnostic.code)
			expect(block).toContain(diagnostic.message)
			expect(block).toContain(warningRegion)
			expect(block).toContain(`^`)
			expect(block.split(`\n`).length).toBeLessThanOrEqual(4)
		}
	})

	it(`removes dead CSS under the fix command`, async () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `app-panel.class {
	> header {}
	> footer {}
}
`,
			"src/AppPanel.tsx": `import css from "./AppPanel.module.css"

export function AppPanel() {
	return <app-panel className={css.class}><header /></app-panel>
}
`,
		})
		const { io, logs } = createTestIO()
		const result = await runLasertagCli([`lasertag`, `fix`], io, {
			cwd: fixture.root,
		})

		expect(result.mode).toBe(`fix`)
		expect(result.targets).toEqual([`**/*.module.css`])
		expect(result.files).toEqual([fixture.path(`src/AppPanel.module.css`)])
		expect(result.changedFiles).toEqual([
			fixture.path(`src/AppPanel.module.css`),
		])
		expect(result.fixedCount).toBe(1)
		expect(result.workerCount).toBe(1)
		expect(result.diagnostics).toEqual([])
		expect(result.exitCode).toBe(0)
		expect(readFileSync(fixture.path(`src/AppPanel.module.css`), `utf-8`))
			.toBe(`app-panel.class {
	> header {}

}
`)
		expect(logs.some((message) => message.includes(`discovered 1`))).toBe(true)
		expect(logs.some((message) => message.includes(`1/1`))).toBe(true)
		expect(logs.some((message) => message.includes(`TOTAL TIME`))).toBe(true)
		expect(logs.at(-1)).toBe(
			`lasertag fix: removed 1 dead selector from 1 file.`,
		)
	})

	it(`runs the generated fix course through real workers with readable chronicle progress`, async () => {
		const course = createFixCourse()
		const fixture = createFixture(course.files)
		const firstRun = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })

		showTrainingCourseStage(`fix cleanup pass`, course.lessons.length)

		const result = await runLasertagCli(
			[`lasertag`, `fix`, `course/**/*.module.css`],
			firstRun.io,
			{
				cwd: fixture.root,
				fixWorkerCount: 2,
			},
		)
		const cssPaths = Object.keys(course.expectedCss)
			.map((filePath) => fixture.path(filePath))
			.toSorted()
		const changedPaths = course.lessons
			.filter((lesson) => lesson.expectedAction === `changed`)
			.map((lesson) => fixture.path(lesson.cssPath))
			.toSorted()
		const expectedFixedCount = course.lessons.reduce(
			(count, lesson) => count + lesson.expectedRemovedSelectors.length,
			0,
		)

		expect(firstRun.errors).toEqual([])
		expect(result.exitCode).toBe(0)
		expect(result.files).toEqual(cssPaths)
		expect(result.changedFiles).toEqual(changedPaths)
		expect(result.fixedCount).toBe(expectedFixedCount)
		expect(result.workerCount).toBe(2)
		expect(result.stealCount).toBeGreaterThanOrEqual(0)

		for (const [filePath, expectedCss] of Object.entries(course.expectedCss)) {
			expect(readFileSync(fixture.path(filePath), `utf-8`)).toBe(expectedCss)
		}

		const progressCounts = firstRun.logs.flatMap((message) => {
			const match = /\b(\d+)\/(\d+)\b/.exec(message)

			return match?.[1] && match[2]
				? [[Number(match[1]), Number(match[2])]]
				: []
		})

		expect(progressCounts).toEqual(
			course.lessons.map((_, index) => [index + 1, course.lessons.length]),
		)
		expect(
			firstRun.logs.some((message) => message.includes(`TOTAL TIME`)),
		).toBe(true)
		expect(
			firstRun.logs.some((message) => message.includes(`started 2 workers`)),
		).toBe(true)
		expect(
			firstRun.logs.some((message) => message.includes(`skipped no TSX`)),
		).toBe(true)
		expect(
			firstRun.logs.some((message) => message.includes(`removed 1 selector`)),
		).toBe(true)
		expect(firstRun.logs.at(-1)).toBe(
			`lasertag fix: removed ${expectedFixedCount} dead selectors from ${changedPaths.length} files.`,
		)

		const secondRun = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })

		showTrainingCourseStage(`fix idempotence pass`, course.lessons.length)

		const idempotentResult = await runLasertagCli(
			[`lasertag`, `fix`, `course/**/*.module.css`],
			secondRun.io,
			{
				cwd: fixture.root,
				fixWorkerCount: 2,
			},
		)

		expect(secondRun.errors).toEqual([])
		expect(idempotentResult.exitCode).toBe(0)
		expect(idempotentResult.changedFiles).toEqual([])
		expect(idempotentResult.fixedCount).toBe(0)
		expect(
			secondRun.logs.some((message) => message.includes(`TOTAL TIME`)),
		).toBe(true)
		expect(
			secondRun.logs.filter((message) => message.includes(` clean `)),
		).toHaveLength(course.lessons.length - 1)
		expect(secondRun.logs.at(-1)).toBe(
			`lasertag fix: no dead CSS found in ${course.lessons.length} files.`,
		)

		for (const [filePath, expectedCss] of Object.entries(course.expectedCss)) {
			expect(readFileSync(fixture.path(filePath), `utf-8`)).toBe(expectedCss)
		}
	}, 30_000)

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
