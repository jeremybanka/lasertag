import { describe, expect, it } from "vite-plus/test"

import { runLasertagCli } from "../../../src/cli/main.ts"

async function invoke(args: string[]) {
	const logs: string[] = []
	const errors: string[] = []
	const result = await runLasertagCli(
		args,
		{
			log: (message) => logs.push(message),
			error: (message) => errors.push(message),
		},
		{
			fileExists: () => false,
			forceColor: false,
			glob: () => [],
			packageVersion: `1.2.3-test`,
		},
	)
	return { errors, logs, result }
}

describe(`CLI arguments`, () => {
	it.each([[], [`--help`], [`--version`], [`check`, `--format=json`]])(
		`preserves command-prefixed helper input %j`,
		async (...words) => {
			const legacy = await invoke([`lasertag`, ...words])
			const runtime = await invoke([`node`, `lasertag`, ...words])
			expect(legacy).toEqual(runtime)
		},
	)

	it(`accepts runtime argv with an entry point unrelated to the command name`, async () => {
		const { logs, result } = await invoke([
			`/runtime/node`,
			`/some/path/cli.mjs`,
			`--version`,
		])
		expect(result.mode).toBe(`version`)
		expect(logs).toEqual([`1.2.3-test`])
	})

	it(`reports ignored options separately from JSON output without failing`, async () => {
		const { errors, logs, result } = await invoke([
			`node`,
			`lasertag`,
			`check`,
			`--format=json`,
			`--show-stroy`,
			`--build-only`,
		])
		expect(result.exitCode).toBe(0)
		expect(logs).toHaveLength(1)
		expect(JSON.parse(logs[0]!)).toMatchObject({ diagnostics: [] })
		expect(errors.join(`\n`)).toContain(`--show-stroy`)
		expect(errors.join(`\n`)).toContain(`--build-only`)
		expect(errors.join(`\n`)).toContain(`check`)
		expect(errors.join(`\n`)).not.toContain(`\u001b`)
	})

	it(`keeps clean invocations quiet on stderr`, async () => {
		const { errors } = await invoke([`node`, `lasertag`, `check`, `-f=json`])
		expect(errors).toEqual([])
	})

	it.each([`check`, `fix`])(
		`preserves %s before -- and treats dash-prefixed targets literally`,
		async (command) => {
			const { errors, result } = await invoke([
				`node`,
				`lasertag`,
				command,
				`--`,
				`--show-story.module.css`,
			])
			expect(result.mode).toBe(command)
			expect(result.targets).toEqual([`--show-story.module.css`])
			expect(errors).toEqual([])
		},
	)

	it(`accepts check options before the command`, async () => {
		const { errors, result } = await invoke([
			`node`,
			`lasertag`,
			`--format=json`,
			`check`,
			`src/**/*.module.css`,
		])
		expect(result.options).toMatchObject({ format: `json` })
		expect(result.targets).toEqual([`src/**/*.module.css`])
		expect(errors).toEqual([])
	})
})
