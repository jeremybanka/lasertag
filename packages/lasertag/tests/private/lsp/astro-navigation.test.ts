import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { beforeEach, describe, expect, it, vi } from "vite-plus/test"
import {
	CancellationToken,
	CancellationTokenSource,
} from "vscode-languageserver/node"

const lifecycle = vi.hoisted(() => ({ created: 0, closed: 0 }))
vi.mock(`typescript/sync`, async (importOriginal) => {
	const typescript = await importOriginal<typeof import("typescript/sync")>()
	return {
		...typescript,
		API: class extends typescript.API {
			constructor(options?: ConstructorParameters<typeof typescript.API>[0]) {
				super(options)
				lifecycle.created++
			}
			override get close() {
				const close = super.close
				return Object.assign(
					() => {
						lifecycle.closed++
						close()
					},
					{ gen: close.gen.bind(close) },
				)
			}
		},
	}
})

import {
	createAstroNavigationAnalyzer,
	createAstroNavigationService,
	type AstroNavigationTask,
} from "../../../src/lsp/astro-navigation.ts"
import { createOfficialAstroProject } from "../../public/lsp/fixtures/astro-project.ts"
import { astroNavigationInitializationOptions } from "../../../src/vscode/config.ts"

describe(`Astro navigation lifecycle`, () => {
	beforeEach(() => {
		lifecycle.created = 0
		lifecycle.closed = 0
	})

	it(`requires workspace trust as well as the VS Code setting`, () => {
		for (const [enabled, trusted] of [
			[false, false],
			[true, false],
			[false, true],
		]) {
			expect(astroNavigationInitializationOptions(enabled!, trusted!)).toEqual({
				astroNavigation: { enabled: false, runExternalCode: false },
			})
		}
		expect(astroNavigationInitializationOptions(true, true)).toEqual({
			astroNavigation: { enabled: true, runExternalCode: true },
		})
	})

	it(`creates the native session lazily and reuses it across requests and document edits`, () => {
		using project = createOfficialAstroProject({
			"Card.tsx": `export function ActualCard() { return <actual-card /> }`,
		})
		const sourceText = `---\nimport { ActualCard } from "./Card.tsx"\n---\n<ActualCard />`
		const { filePath } = project.options(sourceText)
		const task: AstroNavigationTask = {
			filePath,
			sourceText,
			offset: sourceText.indexOf(`<ActualCard`) + 1,
			openFiles: [],
			diskRevision: 0,
		}
		const analyzer = createAstroNavigationAnalyzer()
		try {
			expect(lifecycle.created).toBe(0)
			expect(analyzer.analyze({ ...task, offset: 0 })).toEqual([])
			expect(lifecycle.created).toBe(0)
			const first = analyzer.analyze(task)
			expect(first).toHaveLength(1)
			expect(analyzer.analyze(task)).toEqual(first)
			expect(
				analyzer.analyze({
					...task,
					sourceText: `${sourceText}\n<!-- edit -->`,
				}),
			).toEqual(first)
			expect(lifecycle.created).toBe(1)
			const other = project.options(sourceText, `Other.astro`)
			expect(analyzer.analyze({ ...task, ...other })).toHaveLength(1)
			expect(lifecycle.created).toBe(1)
		} finally {
			analyzer.close()
		}
		expect(lifecycle.closed).toBe(1)
	})

	it(`does not start a worker for an already canceled request`, async () => {
		const service = createAstroNavigationService(
			new URL(`file:///does-not-exist.ts`),
		)
		const token = new CancellationTokenSource()
		token.cancel()
		expect(
			await service.request(
				{
					filePath: `/App.astro`,
					sourceText: ``,
					offset: 0,
					openFiles: [],
					diskRevision: 0,
				},
				token.token,
			),
		).toEqual([])
		await service.reset()
		token.dispose()
	})

	it(`times out a hung mapper and releases its process`, async () => {
		using project = createOfficialAstroProject()
		const marker = path.join(project.root, `mapper-pid`)
		const mapper = path.join(project.root, `mapper`)
		mkdirSync(mapper)
		writeFileSync(
			path.join(mapper, `package.json`),
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
				contentMappers: [{ package: mapper, extensions: [`.astro`] }],
			}),
		)
		const sourceText = `<ExampleCard />`
		const { filePath } = project.options(sourceText)
		const service = createAstroNavigationService(
			new URL(`../../../src/lsp/server.ts`, import.meta.url),
			3_000,
		)
		const result = service.request(
			{ filePath, sourceText, offset: 1, openFiles: [], diskRevision: 0 },
			CancellationToken.None,
		)
		let pid: number | undefined
		try {
			await vi.waitFor(() => expect(existsSync(marker)).toBe(true), {
				timeout: 2_800,
			})
			pid = Number(readFileSync(marker, `utf8`))
			expect(await result).toEqual([])
			await vi.waitFor(
				() => {
					expect(() => process.kill(pid!, 0)).toThrow()
				},
				{ timeout: 3_000 },
			)
		} finally {
			await service.reset()
			if (pid) {
				try {
					process.kill(pid)
				} catch {
					/* Already reaped. */
				}
			}
		}
	}, 10_000)
})
