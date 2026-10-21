import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

import { expect, it, vi } from "vite-plus/test"
import { CancellationTokenSource } from "vscode-languageserver/node"

import {
	createCssAnalysisService,
	fallbackCssAnalysis,
	type CssAnalysisTask,
} from "../../../src/refractor/css-analysis.ts"
import { runLasertagCheck } from "../../../src/cli/check.ts"
import { runLasertagFix } from "../../../src/cli/fix.ts"
import { mapperInitializationOptions } from "../../../src/vscode/config.ts"
import { createLspClient } from "../../public/lsp/helpers/client.ts"
import {
	createCssMapperProject,
	cssMapperPath,
} from "../../public/lsp/fixtures/css-project.ts"

const source = `import css from "./AppPanel.module.css"; export const AppPanel = () => <app-panel className={css.class}><span /></app-panel>`
const css = `app-panel.class { > missing {} > span {} }`

it(`passes workspace trust without feature settings`, () => {
	expect(mapperInitializationOptions(false)).toEqual({
		workspaceTrusted: false,
	})
	expect(mapperInitializationOptions(true)).toEqual({ workspaceTrusted: true })
})

function observedProject() {
	const project = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
		"OtherPanel.tsx": source
			.replaceAll(`AppPanel`, `OtherPanel`)
			.replaceAll(`app-panel`, `other-panel`),
		"OtherPanel.module.css": css.replaceAll(`app-panel`, `other-panel`),
	})
	const marker = path.join(project.root, `mapper-starts`)
	const script = project.write(
		`mapper/entry.ts`,
		`import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, String(process.pid) + "\\n"); await import(${JSON.stringify(pathToFileURL(path.join(cssMapperPath, `lib/content-mapper.js`)).href)})`,
	)
	project.write(
		`mapper/package.json`,
		JSON.stringify({
			name: `observed-mapper`,
			version: `1.0.0`,
			type: `module`,
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
			compilerOptions: {
				jsx: `preserve`,
				moduleResolution: `bundler`,
				module: `esnext`,
			},
			contentMappers: [
				{
					package: path.join(project.root, `mapper`),
					extensions: [`.module.css`],
				},
			],
		}),
	)
	return { project, marker }
}

it(
	`reuses one mapper across CLI files and refreshes fix evidence`,
	{ timeout: 20_000 },
	async () => {
		const observed = observedProject()
		using project = observed.project
		const { marker } = observed
		const files = [`AppPanel`, `OtherPanel`].map((name) =>
			path.join(project.root, `${name}.module.css`),
		)
		const checked = await runLasertagCheck(files)
		expect(checked.failures).toEqual([])
		expect(
			checked.fileResults.every(
				(file) =>
					file.ownership?.status === `available` &&
					file.ownership.attachments[0]?.status === `sibling`,
			),
		).toBe(true)
		expect(readFileSync(marker, `utf8`).trim().split(`\n`)).toHaveLength(1)
		const fixed = await runLasertagFix(files)
		expect(fixed.failures).toEqual([])
		expect(fixed.changedFiles).toHaveLength(2)
		for (const file of fixed.fileResults) {
			if (file.ownership?.status !== `available`)
				throw new Error(`No evidence after fix`)
			const target = file.ownership.attachments[0]!.targets[0]!
			expect(
				readFileSync(file.cssPath, `utf8`).slice(
					target.range!.start,
					target.range!.end,
				),
			).toBe(`class`)
		}
		expect(readFileSync(marker, `utf8`).trim().split(`\n`)).toHaveLength(2)
		const parallel = await runLasertagCheck(files, {
			workerCount: 2,
			workerModuleUrl: new URL(`../../../src/cli/main.ts`, import.meta.url),
		})
		expect(parallel.workerCount).toBe(2)
		expect(
			parallel.fileResults.every(
				(file) => file.ownership?.status === `available`,
			),
		).toBe(true)
		const processIds = readFileSync(marker, `utf8`)
			.trim()
			.split(`\n`)
			.map(Number)
		expect(processIds).toHaveLength(
			2 + new Set(parallel.fileResults.map((file) => file.workerId)).size,
		)
		await vi.waitFor(
			() => {
				for (const pid of processIds)
					expect(() => process.kill(pid, 0)).toThrow()
			},
			{ timeout: 3_000 },
		)
	},
)

it(
	`reuses one mapper across LSP edits and releases closed sessions`,
	{ timeout: 20_000 },
	async () => {
		const observed = observedProject()
		using project = observed.project
		const { marker } = observed
		await using client = createLspClient(project.root)
		await client.initialize()
		const sourcePath = path.join(project.root, `AppPanel.tsx`)
		const query = () =>
			client.request(`lasertag/renderStory`, {
				uri: pathToFileURL(sourcePath).href,
			})
		client.open(sourcePath, source, `typescriptreact`)
		expect(await query()).toMatchObject({ ownership: { status: `available` } })
		client.change(sourcePath, `${source}\n// edit`)
		expect(await query()).toMatchObject({ ownership: { status: `available` } })
		const starts = readFileSync(marker, `utf8`).trim().split(`\n`)
		expect(starts).toHaveLength(1)
		client.close(sourcePath)
		await vi.waitFor(
			() => expect(() => process.kill(Number(starts[0]), 0)).toThrow(),
			{ timeout: 3_000 },
		)
		// Allow the ordinary post-close diagnostics debounce to complete.
		await setTimeout(250)
		expect(readFileSync(marker, `utf8`).trim().split(`\n`)).toHaveLength(1)
		client.open(sourcePath, source, `typescriptreact`)
		expect(await query()).toMatchObject({ ownership: { status: `available` } })
		expect(readFileSync(marker, `utf8`).trim().split(`\n`)).toHaveLength(2)
	},
)

it(`times out a hung CSS mapper, cleans up its process and recovers on the next request`, async () => {
	using project = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
	})
	const marker = path.join(project.root, `mapper-pid`)
	project.write(
		`mapper/package.json`,
		JSON.stringify({
			name: `hanging-mapper`,
			version: `1.0.0`,
			typescript: {
				contentMapper: {
					exec: [
						process.execPath,
						fileURLToPath(
							new URL(`./fixtures/hanging-astro-mapper.ts`, import.meta.url),
						),
						marker,
					],
					compilerOptions: [],
				},
			},
		}),
	)
	project.write(
		`tsconfig.json`,
		JSON.stringify({
			contentMappers: [
				{
					package: path.join(project.root, `mapper`),
					extensions: [`.module.css`],
				},
			],
		}),
	)
	const service = createCssAnalysisService(
		new URL(`../../../src/lsp/server.ts`, import.meta.url),
		3_000,
	)
	const task: CssAnalysisTask = {
		sourcePath: path.join(project.root, `AppPanel.tsx`),
		sourceText: source,
		cssPath: path.join(project.root, `AppPanel.module.css`),
		cssSource: css,
	}
	const pending = service.request(task)
	try {
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), {
			timeout: 2_800,
		})
		const pid = Number(readFileSync(marker, `utf8`))
		expect(await pending).toBeUndefined()
		expect(fallbackCssAnalysis(task).ownership.status).toBe(`unavailable`)
		await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
			timeout: 3_000,
		})
		project.write(
			`tsconfig.json`,
			JSON.stringify({
				contentMappers: [
					{ package: cssMapperPath, extensions: [`.module.css`] },
				],
			}),
		)
		expect(await service.request({ ...task, diskRevision: 1 })).toMatchObject({
			ownership: { status: `available`, attachments: [{ status: `sibling` }] },
		})
		const token = new CancellationTokenSource()
		token.cancel()
		expect(await service.request(task, token.token)).toBeUndefined()
		token.dispose()
	} finally {
		await service.reset()
	}
}, 10_000)
