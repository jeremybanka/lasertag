import { describe, expect, it } from "vitest"

import { runLasertagCli } from "../src/main.ts"

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

describe(`lasertag cli`, () => {
	it(`validates by default`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`], io)

		expect(result.mode).toBe(`validate`)
		expect(result.options.fix).toBe(false)
		expect(logs).toEqual([
			`lasertag validate: render-story CSS validation is stubbed.`,
		])
	})

	it(`runs the fix stub when --fix is passed`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--fix`], io)

		expect(result.mode).toBe(`fix`)
		expect(result.options.fix).toBe(true)
		expect(logs).toEqual([`lasertag fix: dead CSS cleanup is stubbed.`])
	})

	it(`keeps validate mode when --fix=false is passed`, () => {
		const { io } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--fix=false`], io)

		expect(result.mode).toBe(`validate`)
		expect(result.options.fix).toBe(false)
	})

	it(`prints help when --help is passed`, () => {
		const { io, logs } = createTestIO()
		const result = runLasertagCli([`lasertag`, `--help`], io)

		expect(result.mode).toBe(`help`)
		expect(logs[0]).toContain(`USAGE`)
		expect(logs[0]).toContain(`--fix`)
	})
})
