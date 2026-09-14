import { describe, expect, it } from "vite-plus/test"

import {
	runLasertagCli,
	type LasertagCliEnvironment,
} from "../../../src/cli/main.ts"

function unexpectedApplicationWork(): never {
	throw new Error(`Completion must not run application commands`)
}

const completionEnvironment: LasertagCliEnvironment = {
	buildVsix: unexpectedApplicationWork,
	fileExists: unexpectedApplicationWork,
	glob: unexpectedApplicationWork,
	installVscodeExtension: unexpectedApplicationWork,
	readFile: unexpectedApplicationWork,
	writeFile: unexpectedApplicationWork,
}

async function invoke(words: string[]) {
	const logs: string[] = []
	const errors: string[] = []
	const result = await runLasertagCli(
		[`node`, `lasertag`, ...words],
		{
			log: (message) => logs.push(message),
			error: (message) => errors.push(message),
		},
		completionEnvironment,
	)
	expect(result.mode).toBe(`completion`)
	expect(result.exitCode).toBe(0)
	expect(errors).toEqual([])
	expect(logs).toHaveLength(1)
	return logs[0]!
}

async function candidates(...words: string[]) {
	const output = await invoke([`__completeNoDesc`, ...words])
	return output.trimEnd().split(`\n`)
}

describe(`CLI completion`, () => {
	it(`suggests application and completion management commands`, async () => {
		expect(await candidates(``)).toEqual(
			expect.arrayContaining([`check`, `fix`, `vsix`, `completion`]),
		)
		expect(await candidates(`completion`, ``)).toContain(`install`)
		expect(await candidates(`completion`, `install`, ``)).toEqual(
			expect.arrayContaining([`bash`, `zsh`, `fish`, `nushell`, `carapace`]),
		)
	})

	it(`suggests route options and schema-derived values`, async () => {
		expect(await candidates(`check`, `--`)).toEqual(
			expect.arrayContaining([`--format`, `--max-files`, `--show-story`]),
		)
		expect(await candidates(`check`, `--format`, ``)).toEqual(
			expect.arrayContaining([`stylish`, `json`]),
		)
		expect(await candidates(`check`, `--format=j`)).toContain(`json`)
		expect(await candidates(`check`, `--max-files`, ``)).toContain(`all`)
		expect(await candidates(`vsix`, `--target`, ``)).toEqual(
			expect.arrayContaining([`code`, `code-insiders`, `cursor`]),
		)
		expect(await candidates(`fix`, `--`)).not.toContain(`--format`)
	})

	it(`hides supplied singleton options before and after the optional target`, async () => {
		for (const target of [[], [`src/AppPanel.module.css`]]) {
			const values = await candidates(`check`, `-f`, `json`, ...target, `--`)
			expect(values).not.toContain(`--format`)
			expect(values).toContain(`--show-story`)
		}
	})

	it(`requests file completion for targets and directory completion for outdir`, async () => {
		// Cobra's final directive: 0 allows files, 16 restricts to directories.
		for (const command of [`check`, `fix`]) {
			expect((await candidates(command, `src/`)).at(-1)).toBe(`:0`)
			expect((await candidates(command, `--`, `src/`)).at(-1)).toBe(`:0`)
		}
		expect((await candidates(`vsix`, `--outdir`, `dist/`)).at(-1)).toBe(`:16`)
	})

	it(`completes without validating options or running commands`, async () => {
		expect(await candidates(`check`, `--max-files=invalid`, `--f`)).toContain(
			`--format`,
		)
		await candidates(`fix`, ``)
		await candidates(`vsix`, ``)
	})

	it.each([`bash`, `zsh`, `fish`, `nushell`, `carapace`])(
		`prints a %s integration without application work`,
		async (shell) => {
			const script = await invoke([`completion`, shell])
			expect(script).toContain(`lasertag`)
			expect(script.length).toBeGreaterThan(100)
		},
	)

	it(`routes installation requests to completion usage validation`, async () => {
		await expect(
			invoke([`completion`, `install`, `unsupported`]),
		).rejects.toThrow(
			`lasertag completion install <bash|zsh|fish|nushell|carapace>`,
		)
	})
})
