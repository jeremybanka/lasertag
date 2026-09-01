import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vitest"
import {
	CodeActionKind,
	DiagnosticSeverity,
	type InitializeParams,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	createLasertagLspState,
	type LasertagLspStateEnvironment,
	type LspDocumentInput,
} from "../../../src/lsp/state.ts"
import {
	createLasertagLspLogger,
	logLevelFromEnvironment,
	type LasertagLspLogSink,
} from "../../../src/lsp/logger.ts"
import {
	clientSupportsWorkspaceFolderChangeEvents,
	createCleanUpDeadSelectorsCodeAction,
	createInitializeResult,
	createRefractorDiagnostics,
	findSiblingTsxPath,
	logAnalysisTrace,
} from "../../../src/lsp/server.ts"
import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
} from "../../../src/lsp/code-actions.ts"

const cssPath = `/project/src/AppPanel.module.css`
const tsxPath = `/project/src/AppPanel.tsx`
const astroPath = `/project/src/AppPanel.astro`

function fileUri(filePath: string): string {
	return pathToFileURL(filePath).href
}

function createDocumentInput(
	filePath: string,
	text: string,
	version = 1,
	languageId = `css`,
): LspDocumentInput {
	return {
		languageId,
		path: filePath,
		text,
		uri: fileUri(filePath),
		version,
	}
}

function createCssSource(childTagName: string): string {
	return `
		app-panel.class {
			> ${childTagName} {}
		}
	`
}

function createTsxSource(childTagName: string): string {
	return `
		import css from "./AppPanel.module.css"

		export function AppPanel() {
			return (
				<app-panel className={css.class}>
					<${childTagName} />
				</app-panel>
			)
		}
	`
}

function createAstroSource(childTagName: string): string {
	return `<app-panel class={css.class}><${childTagName} /></app-panel>`
}

function createMemoryFileSystem(files: Record<string, string>) {
	const memory = new Map(Object.entries(files))
	type TestGlobOptions = {
		absolute?: boolean
		cwd?: string
		patterns?: readonly string[] | string
	}
	const glob = ((
		patternsOrOptions: readonly string[] | string | TestGlobOptions,
		options?: TestGlobOptions,
	) => {
		const isOptionsCall =
			typeof patternsOrOptions === `object` &&
			!Array.isArray(patternsOrOptions) &&
			`patterns` in patternsOrOptions
		const globOptions = isOptionsCall ? patternsOrOptions : options
		const patterns = isOptionsCall
			? patternsOrOptions.patterns
			: patternsOrOptions
		const patternList = Array.isArray(patterns) ? patterns : [patterns]
		const cwd =
			typeof globOptions?.cwd === `string` ? globOptions.cwd : `/project`
		const absolute = globOptions?.absolute === true

		return [...memory.keys()]
			.filter((filePath) => filePath.startsWith(cwd))
			.filter((filePath) =>
				patternList.some((pattern) => {
					if (pattern === `**/*.module.css`) {
						return filePath.endsWith(`.module.css`)
					}

					if (pattern === `**/*.tsx`) return filePath.endsWith(`.tsx`)
					if (pattern === `**/*.astro`) return filePath.endsWith(`.astro`)

					return false
				}),
			)
			.map((filePath) => (absolute ? filePath : filePath.slice(cwd.length + 1)))
	}) as NonNullable<LasertagLspStateEnvironment[`glob`]>
	const environment: LasertagLspStateEnvironment = {
		fileExists: (filePath) => memory.has(filePath),
		glob,
		readFile: (filePath) => {
			const sourceText = memory.get(filePath)

			if (sourceText === undefined) {
				throw new Error(`Missing test file: ${filePath}`)
			}

			return sourceText
		},
	}

	return {
		deleteFile: (filePath: string) => memory.delete(filePath),
		environment,
		writeFile: (filePath: string, sourceText: string) =>
			memory.set(filePath, sourceText),
	}
}

function createMemoryLogSink() {
	const messages = {
		debug: [] as string[],
		error: [] as string[],
		info: [] as string[],
		log: [] as string[],
		warn: [] as string[],
	}
	const sink: LasertagLspLogSink = {
		debug: (message) => messages.debug.push(message),
		error: (message) => messages.error.push(message),
		info: (message) => messages.info.push(message),
		log: (message) => messages.log.push(message),
		warn: (message) => messages.warn.push(message),
	}

	return { messages, sink }
}

describe(`lasertag lsp`, () => {
	it(`advertises workspace folder notifications when the client supports them`, () => {
		const params = {
			capabilities: {
				workspace: {
					workspaceFolders: true,
				},
			},
		} as InitializeParams

		expect(createInitializeResult(params)).toMatchObject({
			capabilities: {
				textDocumentSync: 2,
				workspace: {
					workspaceFolders: {
						changeNotifications: true,
						supported: true,
					},
				},
			},
			serverInfo: {
				name: `lasertag-lsp`,
			},
		})
	})

	it(`does not ask for workspace folder notifications from unsupported clients`, () => {
		expect(createInitializeResult()).toMatchObject({
			capabilities: {
				textDocumentSync: 2,
				workspace: {
					workspaceFolders: {
						changeNotifications: false,
						supported: true,
					},
				},
			},
			serverInfo: {
				name: `lasertag-lsp`,
			},
		})
		expect(clientSupportsWorkspaceFolderChangeEvents()).toBe(false)
		expect(
			clientSupportsWorkspaceFolderChangeEvents({
				capabilities: {
					workspace: {
						workspaceFolders: false,
					},
				},
			} as InitializeParams),
		).toBe(false)
	})

	it(`advertises cleanup as both a quick fix and source action`, () => {
		expect(
			createInitializeResult().capabilities.codeActionProvider,
		).toMatchObject({
			codeActionKinds: [
				CodeActionKind.QuickFix,
				LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
			],
		})
	})

	it(`advertises block-comment completion trigger characters`, () => {
		expect(
			createInitializeResult().capabilities.completionProvider,
		).toMatchObject({
			triggerCharacters: expect.arrayContaining([`/`, `*`, `@`]),
		})
	})

	it(`finds a sibling tsx file for a css module`, () => {
		expect(
			findSiblingTsxPath(
				`/project/src/AppPanel.module.css`,
				(filePath) => filePath === `/project/src/AppPanel.tsx`,
			),
		).toBe(`/project/src/AppPanel.tsx`)
	})

	it(`does not create diagnostics for non-css-module documents`, () => {
		const document = TextDocument.create(
			`file:///project/src/globals.css`,
			`css`,
			1,
			`body { margin: 0; }`,
		)

		expect(createRefractorDiagnostics(document)).toEqual([])
	})

	it(`maps refractor dead selector diagnostics into LSP diagnostics`, () => {
		const document = TextDocument.create(
			`file:///project/src/AppPanel.module.css`,
			`css`,
			1,
			`
				app-panel.class {
					> footer {}
				}
			`,
		)
		const diagnostics = createRefractorDiagnostics(document, {
			cssPath: `/project/src/AppPanel.module.css`,
			fileExists: (filePath) => filePath === `/project/src/AppPanel.tsx`,
			readFile: () => `
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

		expect(diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])
		expect(diagnostics[0]?.message).toContain(`does not match`)
	})

	it(`creates a no-op cleanup action when there are no dead selectors`, () => {
		const document = TextDocument.create(
			fileUri(cssPath),
			`css`,
			1,
			createCssSource(`header`),
		)
		const action = createCleanUpDeadSelectorsCodeAction(document, [])

		expect(action).toMatchObject({
			diagnostics: [],
			kind: CodeActionKind.QuickFix,
			title: LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
		})
		expect(action.edit?.changes?.[document.uri]).toEqual([])
	})

	it(`creates a cleanup edit for an unused expect-error directive`, () => {
		const comment = `/* @lasertag-expect-error: header used to be conditional */`
		const sourceText = `app-panel.class {
	${comment}
	> header {}
}
`
		const document = TextDocument.create(fileUri(cssPath), `css`, 1, sourceText)
		const commentStart = sourceText.indexOf(comment)
		const action = createCleanUpDeadSelectorsCodeAction(document, [
			{
				code: `unused-expect-error`,
				message: `Unused directive.`,
				range: {
					end: document.positionAt(commentStart + comment.length),
					start: document.positionAt(commentStart),
				},
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])

		expect(action.diagnostics).toMatchObject([{ code: `unused-expect-error` }])
		expect(action.edit?.changes?.[document.uri]).toEqual([
			{
				newText: ``,
				range: {
					end: { character: 0, line: 2 },
					start: { character: 0, line: 1 },
				},
			},
		])
	})
})

describe(`lasertag lsp logging`, () => {
	it(`parses log levels from the environment`, () => {
		expect(logLevelFromEnvironment({ LASERTAG_LSP_LOG_LEVEL: `debug` })).toBe(
			`debug`,
		)
		expect(logLevelFromEnvironment({ LASERTAG_LSP_LOG_LEVEL: `nope` })).toBe(
			`info`,
		)
	})

	it(`routes structured log messages through the lsp console sink`, () => {
		const { messages, sink } = createMemoryLogSink()
		const logger = createLasertagLspLogger(sink, `info`)

		logger.info(`diagnostics`, `published`, {
			cssPath,
			diagnosticCount: 1,
		})

		expect(messages.info).toHaveLength(1)
		expect(messages.info[0]).toContain(`diagnostics published`)
		expect(messages.info[0]).toContain(`diagnosticCount: 1`)
		expect(messages.info[0]).toContain(cssPath)
	})

	it(`logs an analysis summary and the full discovery trace at debug level`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: `<app-panel class={css.class}>{content}</app-panel>`,
		})
		const state = createLasertagLspState(fileSystem.environment)
		const { messages, sink } = createMemoryLogSink()
		const logger = createLasertagLspLogger(sink, `debug`)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		logAnalysisTrace(logger, state.getAnalysisTrace(cssPath))

		expect(messages.info).toHaveLength(1)
		expect(messages.info[0]).toContain(`analysis completed`)
		expect(messages.info[0]).toContain(`unknownSelectorCount: 1`)
		expect(messages.debug).toHaveLength(4)
		expect(messages.debug[0]).toContain(`render source resolution`)
		expect(messages.debug[1]).toContain(`css selectors`)
		expect(messages.debug[2]).toContain(`render story`)
		expect(messages.debug[2]).toContain(
			`unknown Astro expression render branch`,
		)
		expect(messages.debug[3]).toContain(`selector reachability`)
		expect(messages.debug[3]).toContain(`"reachability":"unknown"`)
	})

	it(`binds sink methods before handing them to takua`, () => {
		type ReceiverSensitiveLogSink = LasertagLspLogSink & {
			messages: string[]
		}
		const sink: ReceiverSensitiveLogSink = {
			error(message) {
				this.messages.push(`error:${message}`)
			},
			info(message) {
				this.messages.push(`info:${message}`)
			},
			messages: [],
			warn(message) {
				this.messages.push(`warn:${message}`)
			},
		}
		const logger = createLasertagLspLogger(sink, `info`)

		logger.info(`server`, `initialized`, { workspaceFolderCount: 1 })

		expect(sink.messages).toHaveLength(1)
		expect(sink.messages[0]).toContain(`info:info server initialized`)
	})

	it(`filters messages below the configured log level`, () => {
		const { messages, sink } = createMemoryLogSink()
		const logger = createLasertagLspLogger(sink, `warn`)

		logger.debug(`document`, `changed`, { path: tsxPath })
		logger.info(`diagnostics`, `scheduled`, { path: cssPath })
		logger.warn(`watchers`, `could not register`, { error: `boom` })
		logger.error(`server`, `failed`, { error: `boom` })

		expect(messages.debug).toEqual([])
		expect(messages.info).toEqual([])
		expect(messages.warn).toHaveLength(1)
		expect(messages.error).toHaveLength(1)
	})

	it(`routes takua chronicle marks through the lsp console sink`, () => {
		const { messages, sink } = createMemoryLogSink()
		const logger = createLasertagLspLogger(sink, `info`)
		const chronicle = logger.makeChronicle()

		chronicle.mark(`start`)
		chronicle.mark(`done`)
		chronicle.logMarks()

		expect(
			messages.info.some((message) => message.includes(`TOTAL TIME`)),
		).toBe(true)
	})
})

describe(`lasertag lsp state`, () => {
	it(`does not guess reachability when css.class is not attached`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: `<app-panel><header /></app-panel>`,
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))

		expect(state.getDiagnostics(cssPath)).toEqual([])
		expect(state.getAnalysisTrace(cssPath).summary).toMatchObject({
			cssClassRootCount: 0,
			opaqueCount: 1,
			rootDiscoveryKind: `missing-css-class-attachment`,
			unknownSelectorCount: 2,
			unreachableSelectorCount: 0,
		})
	})

	it(`validates explicit children passed through an Astro layout`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: `---
import Layout from "../layouts/Layout.astro"
import { Dz2Orbital } from "../components/Dz2Orbital"
import css from "./AppPanel.module.css"
---
<Layout>
	<Dz2Orbital client:only />
	<app-panel class={css.class}><header /></app-panel>
</Layout>`,
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))

		expect(state.getDiagnostics(cssPath)).toMatchObject([
			{
				code: `dead-selector`,
				severity: DiagnosticSeverity.Warning,
			},
		])
		expect(state.getAnalysisTrace(cssPath).summary).toMatchObject({
			cssClassRootCount: 1,
			elementCount: 2,
			opaqueCount: 0,
			rootCount: 1,
			rootDiscoveryKind: `css-class-attachment`,
			unknownSelectorCount: 0,
			unreachableSelectorCount: 1,
		})
	})

	it(`traces foreign opaque Astro branches that make a selector inconclusive`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: `<app-panel class={css.class}>{content}</app-panel>`,
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))

		expect(state.getDiagnostics(cssPath)).toMatchObject([
			{
				code: `selector-crosses-ownership-boundary`,
				severity: DiagnosticSeverity.Warning,
			},
		])
		const trace = state.getAnalysisTrace(cssPath)

		expect(trace).toMatchObject({
			renderStoryAnalysis: {
				kind: `ready`,
				renderStory: {
					roots: [
						{
							children: [
								{
									kind: `opaque`,
									reason: `unknown Astro expression render branch`,
								},
							],
							kind: `element`,
							tagName: `app-panel`,
						},
					],
				},
			},
			sourceResolution: {
				kind: `ready`,
				sourcePath: astroPath,
			},
			summary: {
				diagnosticCount: 1,
				elementCount: 1,
				opaqueCount: 1,
				unknownSelectorCount: 1,
			},
		})
		expect(trace.selectorReachability).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					diagnosticCodes: [`selector-crosses-ownership-boundary`],
					reachability: `unknown`,
					resultKind: `path`,
					selector: `app-panel.class > footer`,
				}),
			]),
		)
	})

	it(`validates open CSS against the sibling Astro file on disk`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: createAstroSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))

		expect(state.getDiagnostics(cssPath)).toMatchObject([
			{
				code: `dead-selector`,
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])
	})

	it(`resolves sidebar stories from either side of a component pair`, () => {
		const fileSystem = createMemoryFileSystem({
			[cssPath]: createCssSource(`header`),
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		expect(state.getRenderStoryView(cssPath)).toMatchObject({
			componentName: `AppPanel`,
			kind: `ready`,
			possibilities: [
				{
					roots: [
						{
							label: `app-panel`,
							support: `supported`,
						},
					],
				},
			],
		})
		expect(state.getRenderStoryView(tsxPath)).toMatchObject({
			componentName: `AppPanel`,
			kind: `ready`,
		})
		expect(state.getRenderStoryView(`/project/README.md`)).toEqual({
			kind: `outside-context`,
		})
	})

	it(`shows return alternatives outside the CSS ownership root`, () => {
		const fileSystem = createMemoryFileSystem({
			[cssPath]: createCssSource(`header`),
			[tsxPath]: `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					if (false) return <bad-stuff />

					return Math.random() < 0.5 ? (
						<app-panel className={css.class}><header /></app-panel>
					) : (
						<app-panel-alt><other-stuff /></app-panel-alt>
					)
				}
			`,
		})
		const state = createLasertagLspState(fileSystem.environment)
		const view = state.getRenderStoryView(cssPath)

		expect(view).toMatchObject({
			kind: `ready`,
			possibilities: [
				{
					roots: [{ label: `bad-stuff`, support: `none` }],
				},
				{
					roots: [
						{
							children: [{ label: `header`, support: `supported` }],
							label: `app-panel`,
							support: `supported`,
						},
					],
				},
				{
					roots: [
						{
							children: [{ label: `other-stuff`, support: `none` }],
							label: `app-panel-alt`,
							support: `none`,
						},
					],
				},
			],
		})
	})

	it(`keeps a CSS Module in sidebar context when its render source is missing`, () => {
		const fileSystem = createMemoryFileSystem({
			[cssPath]: createCssSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		expect(state.getRenderStoryView(cssPath)).toMatchObject({
			kind: `unavailable`,
			message: `No same-named .tsx or .astro render source found.`,
		})
	})

	it(`reuses an unchanged disk render source across analysis views`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: createAstroSource(`header`),
		})
		const readFile = fileSystem.environment.readFile
		let readCount = 0
		const state = createLasertagLspState({
			...fileSystem.environment,
			readFile: (filePath) => {
				readCount += 1

				return readFile?.(filePath) ?? ``
			},
		})

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		state.getDiagnostics(cssPath)
		state.getAnalysisTrace(cssPath)

		expect(readCount).toBe(1)
	})

	it(`reports an error when both Astro and TSX neighbors exist`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: createAstroSource(`header`),
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`header`)))

		expect(state.getDiagnostics(cssPath)).toMatchObject([
			{
				code: `ambiguous-render-source`,
				severity: DiagnosticSeverity.Error,
				source: `lasertag`,
			},
		])
		expect(state.getDiagnostics(cssPath)[0]?.message).toContain(astroPath)
		expect(state.getDiagnostics(cssPath)[0]?.message).toContain(tsxPath)
	})

	it(`updates diagnostics when an open Astro render story changes`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: createAstroSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		expect(state.getDiagnostics(cssPath)).toHaveLength(1)

		state.openDocument(
			createDocumentInput(astroPath, createAstroSource(`footer`), 1, `astro`),
		)

		expect(state.getDiagnostics(cssPath)).toEqual([])
	})

	it(`validates open CSS against the sibling TSX file on disk`, () => {
		const fileSystem = createMemoryFileSystem({
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))

		expect(state.getDiagnostics(cssPath)).toMatchObject([
			{
				code: `dead-selector`,
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])
	})

	it(`updates diagnostics when an open CSS module changes`, () => {
		const fileSystem = createMemoryFileSystem({
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		expect(state.getDiagnostics(cssPath)).toHaveLength(1)

		state.openDocument(
			createDocumentInput(cssPath, createCssSource(`header`), 2),
		)

		expect(state.getDiagnostics(cssPath)).toEqual([])
	})

	it(`updates diagnostics when an open TSX render story changes`, () => {
		const fileSystem = createMemoryFileSystem({
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		expect(state.getDiagnostics(cssPath)).toHaveLength(1)

		state.openDocument(
			createDocumentInput(
				tsxPath,
				createTsxSource(`footer`),
				1,
				`typescriptreact`,
			),
		)

		expect(state.getDiagnostics(cssPath)).toEqual([])
	})

	it(`places adoption warnings on the TSX directive instead of the CSS file`, () => {
		const marker = `{/* @lasertag-own-subtree */}`
		const sourceText = `
			import css from "./AppPanel.module.css"

			export function AppPanel() {
				return (
					<app-panel className={css.class}>
						${marker}
						<section />
					</app-panel>
				)
			}
		`
		const fileSystem = createMemoryFileSystem({
			[cssPath]: `app-panel.class {}`,
			[tsxPath]: sourceText,
		})
		const state = createLasertagLspState(fileSystem.environment)
		const document = TextDocument.create(
			fileUri(tsxPath),
			`typescriptreact`,
			1,
			sourceText,
		)
		const markerStart = sourceText.indexOf(marker)

		expect(state.getDiagnostics(tsxPath)).toMatchObject([
			{
				code: `invalid-adoption-target`,
				range: {
					end: document.positionAt(markerStart + marker.length),
					start: document.positionAt(markerStart),
				},
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])
		expect(state.getDiagnostics(cssPath)).toEqual([])
	})

	it(`emits subscribed diagnostics when a disk TSX file refreshes`, () => {
		const fileSystem = createMemoryFileSystem({
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)
		const emissions: DiagnosticSeverity[][] = []

		state.openDocument(createDocumentInput(cssPath, createCssSource(`footer`)))
		const unsubscribe = state.subscribeToCssDiagnostics(
			cssPath,
			(diagnostics) => {
				emissions.push(
					diagnostics.map(
						(diagnostic) =>
							diagnostic.severity ?? DiagnosticSeverity.Information,
					),
				)
			},
		)

		expect(emissions.at(-1)).toEqual([DiagnosticSeverity.Warning])

		fileSystem.writeFile(tsxPath, createTsxSource(`footer`))
		state.refreshDiskFile(tsxPath)

		expect(emissions.at(-1)).toEqual([])

		unsubscribe()
	})

	it(`falls back to disk CSS on close and clears deleted disk files`, () => {
		const fileSystem = createMemoryFileSystem({
			[cssPath]: createCssSource(`footer`),
			[tsxPath]: createTsxSource(`header`),
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.openDocument(createDocumentInput(cssPath, createCssSource(`header`)))
		expect(state.getDiagnostics(cssPath)).toEqual([])

		state.closeDocument(cssPath)
		expect(state.getDiagnostics(cssPath)).toHaveLength(1)

		fileSystem.deleteFile(cssPath)
		state.deleteFile(cssPath)

		expect(state.getDiagnostics(cssPath)).toEqual([])
	})

	it(`indexes workspace CSS modules and render source files for affected-path lookups`, () => {
		const fileSystem = createMemoryFileSystem({
			[astroPath]: createAstroSource(`header`),
			[cssPath]: createCssSource(`footer`),
			"/project/src/not-a-module.css": `body { margin: 0; }`,
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.indexWorkspaceFolders([`/project`])

		expect(state.getKnownCssModulePaths()).toEqual([cssPath])
		expect(state.getWatchedAstroPaths()).toEqual([astroPath])
		expect(state.getWatchedTsxPaths()).toEqual([])
		expect(state.getAffectedCssPathsForRenderSource(astroPath)).toEqual([
			cssPath,
		])
	})
})
