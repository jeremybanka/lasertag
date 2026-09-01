import { readFileSync } from "node:fs"

import { afterEach, expect, it } from "vitest"

import { runLasertagCli } from "../../../src/cli/main.ts"
import { createFixCourse } from "../../public/cli/fix-course.ts"
import { cleanUpFixtures, createFixture, createTestIO } from "./test-support.ts"

const TRAINING_COURSE_OUTPUT =
	process.env.LASERTAG_TRAINING_COURSE_OUTPUT ??
	process.env.LASERTAG_FIX_COURSE_CHRONICLE
const SHOW_TRAINING_COURSE_OUTPUT =
	TRAINING_COURSE_OUTPUT === `1` ||
	(!process.env.CI && TRAINING_COURSE_OUTPUT !== `0`)

afterEach(cleanUpFixtures)

function showTrainingCourseStage(stage: string, lessonCount: number): void {
	if (!SHOW_TRAINING_COURSE_OUTPUT) return

	process.stdout.write(
		`\n[training course] ${stage} — ${lessonCount} lessons\n\n`,
	)
}

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

		return match?.[1] && match[2] ? [[Number(match[1]), Number(match[2])]] : []
	})

	expect(progressCounts).toEqual(
		course.lessons.map((_, index) => [index + 1, course.lessons.length]),
	)
	expect(firstRun.logs.some((message) => message.includes(`TOTAL TIME`))).toBe(
		true,
	)
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
	expect(secondRun.logs.some((message) => message.includes(`TOTAL TIME`))).toBe(
		true,
	)
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
