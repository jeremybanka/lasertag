import { spawnSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { stripVTControlCharacters, styleText } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import { runLasertagCli } from "../../src/cli/main.ts"
import { createFixCourse } from "./fix-course.ts"

const requireFromTest = createRequire(import.meta.url)
const packageJsonPath = requireFromTest.resolve(`../../package.json`)
const packageRoot = path.dirname(packageJsonPath)
const packageVersion = (
	JSON.parse(readFileSync(packageJsonPath, `utf8`)) as { version: string }
).version
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
				if (echo) console.error(message)
			},
			log: (message: string) => {
				logs.push(message)
				if (echo) console.log(message)
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

	it(`runs through a symlinked package path`, () => {
		const root = mkdtempSync(path.join(tmpdir(), `lasertag-cli-symlink-`))
		const linkedPackageRoot = path.join(root, `node_modules`, `lasertag`)

		fixtureRoots.push(root)
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
		expect(logs).toEqual([`✓ No dead CSS found in 1 file.`])
	})

	it(`reports ambiguous Astro and TSX neighbors as a CLI failure`, async () => {
		const fixture = createFixture({
			"src/AppPanel.astro": `<app-panel />`,
			"src/AppPanel.module.css": `app-panel.class {}`,
			"src/AppPanel.tsx": `export const AppPanel = () => <app-panel />`,
		})
		const { errors, io } = createTestIO()
		const result = await runLasertagCli([`lasertag`, `check`], io, {
			cwd: fixture.root,
		})

		expect(result.exitCode).toBe(1)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toContain(`Ambiguous render story`)
		expect(errors[0]).toContain(`AppPanel.astro`)
		expect(errors[0]).toContain(`AppPanel.tsx`)
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
		expect(logs[0]).toContain(`src/AppPanel.module.css  1 warning`)
		expect(logs[0]).toContain(`└─ 3:6  dead-selector`)
		expect(logs[0]).toContain(`dead-selector`)
		expect(logs[0]).toContain(`app-panel.class > footer`)
		expect(logs[0]).toContain(`▲ Check found 1 warning in 1 file`)
		expect(logs[0]).toContain(`CSS modules  1 checked`)
		expect(logs[0]).toContain(`Detail  1 warning in 1 file shown`)
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

	it(`nests warning regions and explanations under their file`, async () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `app-panel.class {
	> footer {}
	> nav {}
}
`,
			"src/AppPanel.tsx": `import css from "./AppPanel.module.css"

export function AppPanel() {
	return <app-panel className={css.class}><header /></app-panel>
}
`,
		})
		const { io, logs } = createTestIO()

		await runLasertagCli([`lasertag`, `check`], io, { cwd: fixture.root })

		expect(logs).toEqual([
			`src/AppPanel.module.css  2 warnings
├─ 2:2  dead-selector
│  1 │ app-panel.class {
│  2 │     > footer {}
│    │     ^^^^^^^^
│    ╰─ Selector "app-panel.class > footer" does not match any supported render story path.
│
└─ 3:2  dead-selector
   3 │     > nav {}
     │     ^^^^^
   4 │ }
     ╰─ Selector "app-panel.class > nav" does not match any supported render story path.

────────────────────────────────────────────────────────

▲ Check found 2 warnings in 1 file

  CSS modules  1 checked
       Detail  2 warnings in 1 file shown`,
		])
	})

	it(`forces Node terminal colors for stylish output`, async () => {
		const fixture = createFixture({
			"src/AppPanel.module.css": `app-panel.class {
	> footer {}
}
`,
			"src/AppPanel.tsx": `import css from "./AppPanel.module.css"

export function AppPanel() {
	return <app-panel className={css.class}><header /></app-panel>
}
`,
			"src/CleanPanel.module.css": `clean-panel.class {
	> header {}
}
`,
			"src/CleanPanel.tsx": `import css from "./CleanPanel.module.css"

export function CleanPanel() {
	return <clean-panel className={css.class}><header /></clean-panel>
}
`,
		})
		const warning = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })

		await runLasertagCli(
			[`lasertag`, `check`, fixture.path(`src/AppPanel.module.css`)],
			warning.io,
			{ cwd: fixture.root, forceColor: true },
		)

		const warningOutput = warning.logs[0] ?? ``
		const forceStyle = (
			format: Parameters<typeof styleText>[0],
			text: string,
		) => styleText(format, text, { validateStream: false })

		expect(warningOutput).toContain(
			forceStyle(`bold`, `src/AppPanel.module.css`),
		)
		expect(warningOutput).toContain(forceStyle(`cyan`, `dead-selector`))
		expect(warningOutput).toContain(
			forceStyle([`bold`, `yellow`], `▲ Check found 1 warning in 1 file`),
		)
		expect(stripVTControlCharacters(warningOutput)).toContain(
			`2 │     > footer {}`,
		)

		const clean = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })

		await runLasertagCli(
			[`lasertag`, `check`, fixture.path(`src/CleanPanel.module.css`)],
			clean.io,
			{ cwd: fixture.root, forceColor: true },
		)

		expect(clean.logs).toEqual([
			forceStyle([`bold`, `green`], `✓ No dead CSS found in 1 file.`),
		])
	})

	it(`shows closest render story possibilities only when requested`, async () => {
		const fixture = createFixture({
			"src/AccountPanel.module.css": `account-panel.class {
	> profile-header {
		> avatars {}
	}
}
`,
			"src/AccountPanel.tsx": `import css from "./AccountPanel.module.css"

export function AccountPanel({ state }: { state: "loading" | "ready" | "failure" }) {
	return (
		<account-panel className={css.class}>
			{state === "loading" ? (
				<loading-state><spinner-ring /></loading-state>
			) : state === "ready" ? (
				<profile-header><avatar /><display-name /></profile-header>
			) : (
				<error-state><retry-button /></error-state>
			)}
		</account-panel>
	)
}
`,
		})
		const regular = createTestIO()
		const detailed = createTestIO({ echo: SHOW_TRAINING_COURSE_OUTPUT })

		await runLasertagCli(
			[`lasertag`, `check`, fixture.path(`src/AccountPanel.module.css`)],
			regular.io,
			{ cwd: fixture.root },
		)
		await runLasertagCli(
			[
				`lasertag`,
				`check`,
				`--show-story`,
				fixture.path(`src/AccountPanel.module.css`),
			],
			detailed.io,
			{ cwd: fixture.root, forceColor: true },
		)

		const regularOutput = regular.logs[0] ?? ``
		const detailedOutput = detailed.logs[0] ?? ``
		const plainDetailedOutput = stripVTControlCharacters(detailedOutput)

		expect(regularOutput).not.toContain(`Render story possibilities`)
		expect(plainDetailedOutput).toContain(
			`Render story possibilities  3 closest`,
		)
		expect(plainDetailedOutput).toContain(
			`Possibility 1  closest path matches 2/3 selector steps`,
		)
		expect(plainDetailedOutput).toContain(`avatar  ← closest rendered path`)
		expect(plainDetailedOutput.match(/avatars  ✕ you are here/g)).toHaveLength(
			3,
		)
		expect(detailedOutput).toContain(
			styleText([`bold`, `red`], `avatars`, { validateStream: false }),
		)
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
			[`lasertag`, `check`, `--max-files=all`, `course/**/*.module.css`],
			output.io,
			{
				checkWorkerCount: 2,
				cwd: fixture.root,
				forceColor: SHOW_TRAINING_COURSE_OUTPUT,
			},
		)
		const renderedOutput = output.logs[0] ?? ``

		expect(output.errors).toEqual([])
		expect(result.mode).toBe(`check`)
		expect(result.exitCode).toBe(1)
		expect(result.diagnostics).toHaveLength(expectedWarningCount)
		expect(result.workerCount).toBe(2)
		expect(result.stealCount).toBeGreaterThanOrEqual(0)
		expect(result.diagnostics.map((diagnostic) => diagnostic.cssPath)).toEqual(
			result.diagnostics.map((diagnostic) => diagnostic.cssPath).toSorted(),
		)
		expect(result.options).toMatchObject({ "max-files": `all` })
		expect(renderedOutput).toContain(
			`▲ Check found ${result.diagnostics.length} warnings`,
		)
		expect(renderedOutput).not.toContain(`Hidden`)

		for (const [index, diagnostic] of result.diagnostics.entries()) {
			const relativeCssPath = path.relative(fixture.root, diagnostic.cssPath)
			const cssSource = course.files[relativeCssPath]

			if (!cssSource || !diagnostic.range) {
				throw new Error(
					`Course warning ${index + 1} is missing source context.`,
				)
			}

			const warningRegion = cssSource
				.slice(diagnostic.range.start, diagnostic.range.end)
				.replaceAll(`\t`, `    `)
				.trim()

			expect(renderedOutput).toContain(diagnostic.code)
			expect(renderedOutput).toContain(diagnostic.message)
			expect(renderedOutput).toContain(warningRegion)
		}

		expect(renderedOutput).toContain(`^`)
	})

	it(`shows at most ten affected files unless max-files is all`, async () => {
		const files: Record<string, string> = {}

		for (let index = 0; index < 11; index += 1) {
			const directory = `src/panel-${String(index).padStart(2, `0`)}`

			files[`${directory}/SamplePanel.module.css`] = `sample-panel.class {
	> footer {}
}
`
			files[`${directory}/SamplePanel.tsx`] =
				`import css from "./SamplePanel.module.css"

export function SamplePanel() {
	return <sample-panel className={css.class}><header /></sample-panel>
}
`
		}

		const fixture = createFixture(files)
		const limited = createTestIO()
		const limitedResult = await runLasertagCli(
			[`lasertag`, `check`, `src/**/*.module.css`],
			limited.io,
			{ cwd: fixture.root },
		)
		const limitedOutput = limited.logs[0] ?? ``

		expect(limitedResult.diagnostics).toHaveLength(11)
		expect(limitedResult.options).toMatchObject({ "max-files": `10` })
		expect(limitedOutput).toContain(
			`src/panel-09/SamplePanel.module.css  1 warning`,
		)
		expect(limitedOutput).not.toContain(
			`src/panel-10/SamplePanel.module.css  1 warning`,
		)
		expect(limitedOutput).toContain(
			`… 1 more affected file containing 1 warning`,
		)
		expect(limitedOutput).toContain(`▲ Check found 11 warnings in 11 files`)
		expect(limitedOutput).toContain(`Detail  10 warnings in 10 files shown`)
		expect(limitedOutput).toContain(`Hidden   1 warning in 1 file`)
		expect(limitedOutput).toContain(
			`Show everything with lasertag check --max-files=all`,
		)

		const unlimited = createTestIO()
		const unlimitedResult = await runLasertagCli(
			[`lasertag`, `check`, `--max-files=all`, `src/**/*.module.css`],
			unlimited.io,
			{ cwd: fixture.root },
		)
		const unlimitedOutput = unlimited.logs[0] ?? ``

		expect(unlimitedResult.options).toMatchObject({ "max-files": `all` })
		expect(unlimitedOutput).toContain(
			`src/panel-10/SamplePanel.module.css  1 warning`,
		)
		expect(unlimitedOutput).not.toContain(`Hidden`)
		expect(unlimitedOutput).not.toContain(`Show everything`)

		const customLimit = createTestIO()
		const customLimitResult = await runLasertagCli(
			[`lasertag`, `check`, `--max-files=3`, `src/**/*.module.css`],
			customLimit.io,
			{ cwd: fixture.root },
		)
		const customLimitOutput = customLimit.logs[0] ?? ``

		expect(customLimitResult.options).toMatchObject({ "max-files": `3` })
		expect(customLimitOutput).toContain(
			`src/panel-02/SamplePanel.module.css  1 warning`,
		)
		expect(customLimitOutput).not.toContain(
			`src/panel-03/SamplePanel.module.css  1 warning`,
		)
		expect(customLimitOutput).toContain(`Detail   3 warnings in 3 files shown`)
		expect(customLimitOutput).toContain(`Hidden   8 warnings in 8 files`)
	})

	it(`rejects a non-positive max-files limit`, async () => {
		const { io } = createTestIO()

		await expect(
			runLasertagCli([`lasertag`, `check`, `--max-files=0`], io),
		).rejects.toThrow(`expected "all" or a positive integer`)
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
		expect(logs.at(-1)).toBe(`lasertag fix: cleaned up 1 diagnostic in 1 file.`)
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
			firstRun.logs.some((message) =>
				message.includes(`skipped no render source`),
			),
		).toBe(true)
		expect(
			firstRun.logs.some((message) =>
				message.includes(`cleaned up 1 diagnostic`),
			),
		).toBe(true)
		expect(firstRun.logs.at(-1)).toBe(
			`lasertag fix: cleaned up ${expectedFixedCount} diagnostics in ${changedPaths.length} files.`,
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
			`lasertag fix: no fixable diagnostics found in ${course.lessons.length} files.`,
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
		expect(logs).toEqual([`✓ No dead CSS found in 1 file.`])
	})

	it(`builds and installs a VSIX with default options`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `1.0.0` }),
		})
		const { io, logs } = createTestIO()
		const packageRoot = fixture.path(`node_modules/lasertag`)
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
			packageRoot,
		})

		expect(result.mode).toBe(`vsix`)
		expect(result.exitCode).toBe(0)
		expect(buildRequests).toEqual([
			{
				outdir: fixture.path(`dist`),
				packageRoot,
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
				cwd: fixture.root,
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

	it(`resolves a build-only VSIX outdir from the caller's working directory`, async () => {
		const fixture = createFixture({
			"consumer/package.json": JSON.stringify({ private: true }),
			"node_modules/lasertag/package.json": JSON.stringify({
				version: `1.0.0`,
			}),
		})
		const { io, logs } = createTestIO()
		const cwd = fixture.path(`consumer`)
		const packageRoot = fixture.path(`node_modules/lasertag`)
		const buildRequests: Array<{ outdir: string; packageRoot?: string }> = []
		let installed = false
		const result = await runLasertagCli(
			[`lasertag`, `vsix`, `-o`, `.`, `--build-only`],
			io,
			{
				buildVsix: async (request) => {
					buildRequests.push(request)

					return {
						buildRoot: fixture.path(`consumer/.lasertag-vsix`),
						vscodeTarget: `linux-x64`,
						vsixPath: fixture.path(`consumer/Lasertag.vsix`),
					}
				},
				cwd,
				installVscodeExtension: () => {
					installed = true
					return { exitCode: 0 }
				},
				packageRoot,
			},
		)

		expect(result.mode).toBe(`vsix`)
		expect(result.exitCode).toBe(0)
		expect(result.options).toMatchObject({
			"build-only": true,
			outdir: `.`,
		})
		expect(buildRequests).toEqual([{ outdir: cwd, packageRoot }])
		expect(installed).toBe(false)
		expect(logs).toEqual([
			`lasertag vsix: built ${fixture.path(`consumer/Lasertag.vsix`)}.`,
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
