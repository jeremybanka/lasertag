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
} from "../../src/lsp/state.ts"
import {
	createLasertagLspLogger,
	logLevelFromEnvironment,
	type LasertagLspLogSink,
} from "../../src/lsp/logger.ts"
import {
	clientSupportsWorkspaceFolderChangeEvents,
	createCleanUpDeadSelectorsCodeAction,
	createInitializeResult,
	createRefractorDiagnostics,
	findSiblingTsxPath,
} from "../../src/lsp/server.ts"
import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
} from "../../src/lsp/code-actions.ts"

const cssPath = `/project/src/AppPanel.module.css`
const tsxPath = `/project/src/AppPanel.tsx`

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

	it(`indexes workspace CSS modules and TSX files for affected-path lookups`, () => {
		const fileSystem = createMemoryFileSystem({
			[cssPath]: createCssSource(`footer`),
			[tsxPath]: createTsxSource(`header`),
			"/project/src/not-a-module.css": `body { margin: 0; }`,
		})
		const state = createLasertagLspState(fileSystem.environment)

		state.indexWorkspaceFolders([`/project`])

		expect(state.getKnownCssModulePaths()).toEqual([cssPath])
		expect(state.getWatchedTsxPaths()).toEqual([tsxPath])
		expect(state.getAffectedCssPathsForTsx(tsxPath)).toEqual([cssPath])
	})
})
