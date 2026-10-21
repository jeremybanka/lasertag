#!/usr/bin/env node

import {
	CSS_ANALYSIS_WORKER,
	createCssAnalysisService,
	fallbackCssAnalysis,
	runCssAnalysisWorker,
} from "../refractor/css-analysis.ts"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import {
	CodeActionKind,
	createConnection,
	DidChangeWatchedFilesNotification,
	FileChangeType,
	Files,
	type CodeAction,
	type CodeActionParams,
	type CompletionItem,
	type CompletionParams,
	type Diagnostic,
	type InitializeParams,
	type InitializeResult,
	type TextEdit,
	type TextDocumentPositionParams,
	type CancellationToken,
	TextDocumentSyncKind,
	TextDocuments,
	WatchKind,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	createLasertagLspState,
	findSiblingTsxPathFromConvention,
	isCssModulePath as isCssModuleFilePath,
	isRenderSourcePath,
	offsetToPosition,
	type LasertagLspAnalysisTrace,
	type LasertagLspStateEnvironment,
	type LspDocumentInput,
} from "./state.ts"
import {
	createLasertagLspLogger,
	logLevelFromEnvironment,
	type LasertagLspLogger,
	type LasertagLspLogLevel,
} from "./logger.ts"
import {
	createDeadSelectorCleanupRanges,
	createExpectErrorCleanupRanges,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
	LASERTAG_RESTART_SERVER_COMMAND,
	LASERTAG_RESTART_SERVER_TITLE,
	type OffsetRange,
} from "./code-actions.ts"
import { createCssModuleCompletionItems } from "./completions.ts"
import {
	LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION,
	LASERTAG_RENDER_STORY_REQUEST,
	type LasertagRenderStoryChangedNotification,
	type LasertagRenderStoryRequest,
	type LasertagRenderStoryView,
} from "./render-story-view.ts"
import {
	ASTRO_NAVIGATION_WORKER,
	createAstroNavigationService,
	navigationLocations,
	runAstroNavigationWorker,
	type AstroNavigationTarget,
} from "./astro-navigation.ts"

export type LasertagLspReadOptions = {
	cssPath?: string
	fileExists?: (filePath: string) => boolean
	readFile?: (filePath: string) => string
}

export type LasertagLspServerOptions = LasertagLspStateEnvironment & {
	debounceMs?: number
	logger?: LasertagLspLogger
	logLevel?: LasertagLspLogLevel
}

type WorkspaceFolderChangeEvent = {
	added: Array<{ uri: string }>
	removed: Array<{ uri: string }>
}

export function isCssModulePath(filePath: string): boolean {
	return isCssModuleFilePath(filePath)
}

export function findSiblingTsxPath(
	cssPath: string,
	fileExists: (filePath: string) => boolean = existsSync,
): string | undefined {
	const candidate = findSiblingTsxPathFromConvention(cssPath)

	return candidate && fileExists(candidate) ? candidate : undefined
}

function getDocumentFilePath(
	document: TextDocument,
	options: LasertagLspReadOptions,
): string | undefined {
	return options.cssPath ?? Files.uriToFilePath(document.uri) ?? undefined
}

function createDocumentInput(
	document: TextDocument,
	filePath: string,
): LspDocumentInput {
	return {
		languageId: document.languageId,
		path: filePath,
		text: document.getText(),
		uri: document.uri,
		version: document.version,
	}
}

export function clientSupportsWorkspaceFolderChangeEvents(
	params?: InitializeParams,
): boolean {
	return params?.capabilities.workspace?.workspaceFolders === true
}

export function createRefractorDiagnostics(
	document: TextDocument,
	options: LasertagLspReadOptions = {},
): Diagnostic[] {
	const filePath = getDocumentFilePath(document, options)

	if (
		!filePath ||
		(!isCssModulePath(filePath) && !isRenderSourcePath(filePath))
	) {
		return []
	}

	const state = createLasertagLspState({
		fileExists: options.fileExists ?? existsSync,
		readFile:
			options.readFile ?? ((filePath) => readFileSync(filePath, `utf-8`)),
	})

	state.openDocument(createDocumentInput(document, filePath))

	return state.getDiagnostics(filePath)
}

/** Standalone clients are trusted unless they explicitly report restricted mode. */
function workspaceAllowsMappers(options: unknown): boolean {
	return !(
		options &&
		typeof options === `object` &&
		`workspaceTrusted` in options &&
		options.workspaceTrusted === false
	)
}

export function createInitializeResult(
	params?: InitializeParams,
): InitializeResult {
	return {
		capabilities: {
			...(workspaceAllowsMappers(params?.initializationOptions)
				? { definitionProvider: true, declarationProvider: true }
				: {}),
			codeActionProvider: {
				codeActionKinds: [
					CodeActionKind.QuickFix,
					LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
				],
			},
			completionProvider: {
				triggerCharacters: [`>`, `[`, `=`, `:`, `.`, `/`, `*`, `@`],
			},
			textDocumentSync: TextDocumentSyncKind.Incremental,
			workspace: {
				workspaceFolders: {
					changeNotifications:
						clientSupportsWorkspaceFolderChangeEvents(params),
					supported: true,
				},
			},
		},
		serverInfo: {
			name: `lasertag-lsp`,
		},
	}
}

function filePathFromUri(uri: string): string | undefined {
	return Files.uriToFilePath(uri) ?? undefined
}

function filePathFromDocument(document: TextDocument): string | undefined {
	return filePathFromUri(document.uri)
}

function workspaceFolderPathsFromInitialize(
	params: InitializeParams,
): string[] {
	const workspaceFolderPaths =
		params.workspaceFolders?.flatMap((workspaceFolder) => {
			const filePath = filePathFromUri(workspaceFolder.uri)

			return filePath ? [filePath] : []
		}) ?? []

	if (workspaceFolderPaths.length > 0) return workspaceFolderPaths

	if (params.rootUri) {
		const rootPath = filePathFromUri(params.rootUri)

		if (rootPath) return [rootPath]
	}

	return []
}

function allWatchedFileChangeKinds(): number {
	return WatchKind.Create | WatchKind.Change | WatchKind.Delete
}

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function stackFromError(error: unknown): string {
	if (error instanceof Error) return error.stack ?? error.message

	if (typeof error === `string`) return error

	try {
		return JSON.stringify(error)
	} catch {
		return String(error)
	}
}

function writeServerEventToStderr(message: string): void {
	try {
		process.stderr.write(`[lasertag-lsp] ${message}\n`)
	} catch {
		// This path is only for process-lifecycle breadcrumbs.
	}
}

let processCrashLoggingRegistered = false

function registerProcessCrashLogging(logger: LasertagLspLogger): void {
	if (processCrashLoggingRegistered) return

	processCrashLoggingRegistered = true
	const originalExit = process.exit.bind(process)

	process.exit = ((code?: number | string | null): never => {
		const exitCode =
			code === null || code === undefined
				? (process.exitCode ?? 0)
				: Number(code)

		if (exitCode !== 0) {
			const stack =
				new Error(`process.exit(${String(code)})`).stack ??
				`process.exit(${String(code)})`

			logger.error(`server`, `process exit requested`, { code, stack })
			writeServerEventToStderr(`process.exit(${String(code)})\n${stack}`)
		}

		return originalExit(code)
	}) as typeof process.exit

	process.on(`disconnect`, () => {
		logger.warn(`server`, `process ipc channel disconnected`)
		writeServerEventToStderr(`process ipc channel disconnected`)
	})
	process.on(`uncaughtExceptionMonitor`, (error, origin) => {
		const stack = stackFromError(error)

		logger.error(`server`, `uncaught exception`, { origin, stack })
		writeServerEventToStderr(`uncaught exception (${origin})\n${stack}`)
	})
}

function durationMs(start: number): number {
	return Number((performance.now() - start).toFixed(2))
}

export function logAnalysisTrace(
	logger: LasertagLspLogger,
	trace: LasertagLspAnalysisTrace,
): void {
	logger.info(`analysis`, `completed`, {
		cssPath: trace.cssPath,
		...trace.summary,
	})
	logger.debug(`analysis`, `render source resolution`, {
		cssPath: trace.cssPath,
		...trace.sourceResolution,
	})
	logger.debug(`analysis`, `css selectors`, {
		cssAnalysis: trace.cssAnalysis,
		cssPath: trace.cssPath,
	})
	logger.debug(`analysis`, `render story`, {
		cssPath: trace.cssPath,
		renderStoryAnalysis: trace.renderStoryAnalysis,
	})
	logger.debug(`analysis`, `selector reachability`, {
		cssPath: trace.cssPath,
		publishedDiagnostics: trace.publishedDiagnostics,
		reachabilityDiagnostics: trace.reachabilityDiagnostics,
		selectors: trace.selectorReachability,
	})
}

function watchedFileChangeTypeName(type: FileChangeType): string {
	switch (type) {
		case FileChangeType.Changed:
			return `changed`
		case FileChangeType.Created:
			return `created`
		case FileChangeType.Deleted:
			return `deleted`
		default:
			return `unknown`
	}
}

function isLasertagCleanableDiagnostic(diagnostic: Diagnostic): boolean {
	return (
		diagnostic.source === `lasertag` &&
		(diagnostic.code === `dead-selector` ||
			diagnostic.code === `impossible-local-class` ||
			diagnostic.code === `unused-expect-error`)
	)
}

function diagnosticToOffsetRange(
	document: TextDocument,
	diagnostic: Diagnostic,
): OffsetRange {
	return {
		end: document.offsetAt(diagnostic.range.end),
		start: document.offsetAt(diagnostic.range.start),
	}
}

function createDeleteTextEdit(
	sourceText: string,
	range: OffsetRange,
): TextEdit {
	return {
		newText: ``,
		range: {
			end: offsetToPosition(sourceText, range.end),
			start: offsetToPosition(sourceText, range.start),
		},
	}
}

function codeActionKindMatches(
	actionKind: string,
	requestedKind: string,
): boolean {
	return (
		actionKind === requestedKind || actionKind.startsWith(`${requestedKind}.`)
	)
}

function shouldIncludeCodeActionKind(
	actionKind: string,
	requestedKinds: readonly string[] | undefined,
): boolean {
	return (
		!requestedKinds ||
		requestedKinds.length === 0 ||
		requestedKinds.some((requestedKind) =>
			codeActionKindMatches(actionKind, requestedKind),
		)
	)
}

function cleanUpDeadSelectorsKindForRequest(
	requestedKinds: readonly string[] | undefined,
): string | undefined {
	if (!requestedKinds || requestedKinds.length === 0) {
		return CodeActionKind.QuickFix
	}

	if (
		shouldIncludeCodeActionKind(
			LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
			requestedKinds,
		)
	) {
		return LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND
	}

	if (shouldIncludeCodeActionKind(CodeActionKind.QuickFix, requestedKinds)) {
		return CodeActionKind.QuickFix
	}
}

export function createCleanUpDeadSelectorsCodeAction(
	document: TextDocument,
	diagnostics: Diagnostic[],
	kind: string = CodeActionKind.QuickFix,
): CodeAction {
	const cleanableDiagnostics = diagnostics.filter(isLasertagCleanableDiagnostic)
	const deadSelectorDiagnostics = cleanableDiagnostics.filter(
		(diagnostic) => diagnostic.code !== `unused-expect-error`,
	)
	const unusedExpectErrorDiagnostics = cleanableDiagnostics.filter(
		(diagnostic) => diagnostic.code === `unused-expect-error`,
	)
	const sourceText = document.getText()
	const cleanupRanges = [
		...createDeadSelectorCleanupRanges(
			sourceText,
			deadSelectorDiagnostics.map((diagnostic) =>
				diagnosticToOffsetRange(document, diagnostic),
			),
		),
		...createExpectErrorCleanupRanges(
			sourceText,
			unusedExpectErrorDiagnostics.map((diagnostic) =>
				diagnosticToOffsetRange(document, diagnostic),
			),
		),
	]

	return {
		diagnostics: cleanableDiagnostics,
		edit: {
			changes: {
				[document.uri]: cleanupRanges.map((range) =>
					createDeleteTextEdit(sourceText, range),
				),
			},
		},
		kind,
		title: LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
	}
}

export function createLasertagLspServer(
	options: LasertagLspServerOptions = {},
) {
	const connection = createConnection()
	const documents = new TextDocuments(TextDocument)
	const state = createLasertagLspState(options)
	const debounceMs = options.debounceMs ?? 75
	const logger =
		options.logger ??
		createLasertagLspLogger(
			connection.console,
			options.logLevel ?? logLevelFromEnvironment(),
		)
	const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>()
	let clientSupportsDynamicWatchedFiles = false
	let clientSupportsWorkspaceFolderChanges = false
	let workspaceFolderPaths: string[] = []
	const navigation = createAstroNavigationService(new URL(import.meta.url))
	let navigationEnabled = false
	let cssEnabled = false
	let cssRevision = 0
	let cssDiskRevision = 0
	const cssAnalysis = createCssAnalysisService(new URL(import.meta.url))
	const cssRequests = new Map<string, Promise<boolean>>()
	function invalidateCssAnalysis(disk = false) {
		if (!cssEnabled) return
		cssRevision++
		if (disk) cssDiskRevision++
		cssRequests.clear()
		state.setMappedCssAnalysis(null)
	}
	function inWorkspace(filePath: string) {
		return workspaceFolderPaths.some((folder) => {
			const relative = path.relative(folder, filePath)
			return (
				relative !== `..` &&
				!relative.startsWith(`..${path.sep}`) &&
				!path.isAbsolute(relative)
			)
		})
	}
	async function ensureCssAnalysis(
		filePath: string,
		token?: CancellationToken,
	): Promise<boolean> {
		if (!cssEnabled || !inWorkspace(filePath)) return true
		if (token?.isCancellationRequested) return false
		const input = state.getCssAnalysisInput(filePath)
		if (!input || !inWorkspace(input.sourcePath)) return true
		const revision = cssRevision
		let pending = cssRequests.get(input.cssPath)
		if (!pending) {
			const task = {
				...input,
				diskRevision: cssDiskRevision,
				openFiles: documents.all().flatMap((doc) => {
					const name = filePathFromDocument(doc)
					return name ? [[name, doc.getText()] as [string, string]] : []
				}),
			}
			pending = (async () => {
				let result = await cssAnalysis.request(task)
				if (revision !== cssRevision || !cssEnabled) return false
				try {
					result ??= fallbackCssAnalysis(task)
				} catch {
					return true
				}
				state.setMappedCssAnalysis({ task, result })
				return true
			})()
			cssRequests.set(input.cssPath, pending)
		}
		let cancel: { dispose(): void } | undefined
		try {
			const ready = token
				? await Promise.race([
						pending,
						new Promise<boolean>((resolve) => {
							cancel = token.onCancellationRequested(() => resolve(false))
						}),
					])
				: await pending
			return (
				ready && !token?.isCancellationRequested && revision === cssRevision
			)
		} finally {
			cancel?.dispose()
		}
	}
	function scheduleOpenCss() {
		if (cssEnabled)
			for (const name of state.getOpenDocumentPaths())
				if (isCssModulePath(name) || isRenderSourcePath(name))
					scheduleDiagnostics(name)
	}
	function hasOpenCssContext() {
		return documents.all().some((doc) => {
			const name = filePathFromDocument(doc)
			return name && (isCssModulePath(name) || isRenderSourcePath(name))
		})
	}

	let definitionLinkSupport = false
	let declarationLinkSupport = false
	let navigationRevision = 0
	let navigationDiskRevision = 0

	connection.onShutdown(async () => {
		navigationEnabled = false
		invalidateCssAnalysis()
		cssEnabled = false
		await cssAnalysis.reset()
		for (const timer of diagnosticTimers.values()) clearTimeout(timer)
		diagnosticTimers.clear()
		await navigation.reset()
		logger.info(`server`, `shutdown requested`)
	})
	connection.onExit(() => {
		invalidateCssAnalysis()
		cssEnabled = false
		void cssAnalysis.reset()
		void navigation.reset()
		logger.warn(`server`, `exit notification received`)
		writeServerEventToStderr(`exit notification received`)
	})

	function logWorkspaceIndex(event: string, startedAt: number): void {
		logger.info(`workspace`, event, {
			astroCount: state.getWatchedAstroPaths().length,
			cssModuleCount: state.getKnownCssModulePaths().length,
			durationMs: durationMs(startedAt),
			tsxCount: state.getWatchedTsxPaths().length,
			workspaceFolderCount: workspaceFolderPaths.length,
		})
	}

	function clearPendingDiagnostics(filePath: string): void {
		const timer = diagnosticTimers.get(filePath)

		if (timer) {
			clearTimeout(timer)
			diagnosticTimers.delete(filePath)
			logger.debug(`diagnostics`, `cleared pending timer`, { filePath })
		}
	}

	async function publishDiagnostics(filePath: string): Promise<void> {
		const isCssModule = isCssModulePath(filePath)

		if (!isCssModule && !isRenderSourcePath(filePath)) return

		// Closing the last document may still refresh ordinary diagnostics. Those
		// background updates must not restart the mapper process just released.
		if (
			cssEnabled &&
			hasOpenCssContext() &&
			!(await ensureCssAnalysis(filePath))
		)
			return
		const startedAt = performance.now()
		const logLevel = logger.getLevel()
		const chronicle = logLevel === `debug` ? logger.makeChronicle() : undefined

		chronicle?.mark(`diagnostics started`)
		const diagnostics = state.getDiagnostics(filePath)
		chronicle?.mark(`diagnostics resolved`)
		const analysisTrace =
			isCssModule && (logLevel === `debug` || logLevel === `info`)
				? state.getAnalysisTrace(filePath)
				: undefined
		chronicle?.mark(`analysis trace resolved`)
		const uri = state.getDocumentUri(filePath)

		void connection.sendDiagnostics({
			diagnostics,
			uri,
		})
		if (isCssModule) {
			void connection.sendNotification(
				LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION,
				{ uri } satisfies LasertagRenderStoryChangedNotification,
			)
		}
		chronicle?.mark(`diagnostics queued`)
		logger.info(`diagnostics`, `published`, {
			filePath,
			diagnosticCount: diagnostics.length,
			durationMs: durationMs(startedAt),
			uri,
		})
		if (analysisTrace) logAnalysisTrace(logger, analysisTrace)
		chronicle?.mark(`analysis logged`)
		chronicle?.logMarks()

		if (isCssModule) {
			const sourcePath = state.getRenderSourcePath(filePath)

			if (sourcePath) void publishDiagnostics(sourcePath)
		}
	}

	function scheduleDiagnostics(filePath: string): void {
		if (!isCssModulePath(filePath) && !isRenderSourcePath(filePath)) return

		clearPendingDiagnostics(filePath)

		if (debounceMs <= 0) {
			logger.debug(`diagnostics`, `publishing immediately`, { filePath })
			void publishDiagnostics(filePath)
			return
		}

		logger.debug(`diagnostics`, `scheduled`, { filePath, debounceMs })
		diagnosticTimers.set(
			filePath,
			setTimeout(() => {
				diagnosticTimers.delete(filePath)
				void publishDiagnostics(filePath)
			}, debounceMs),
		)
	}

	function clearDiagnostics(
		filePath: string,
		uri = state.getDocumentUri(filePath),
	): void {
		clearPendingDiagnostics(filePath)
		void connection.sendDiagnostics({
			diagnostics: [],
			uri,
		})
		if (isCssModulePath(filePath)) {
			void connection.sendNotification(
				LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION,
				{ uri } satisfies LasertagRenderStoryChangedNotification,
			)
		}
		logger.info(`diagnostics`, `cleared`, { filePath, uri })
	}

	function scheduleAffectedCssForRenderSource(sourcePath: string): void {
		const affectedCssPaths =
			state.getAffectedCssPathsForRenderSource(sourcePath)

		logger.info(`render-source`, `scheduling affected css`, {
			affectedCssCount: affectedCssPaths.length,
			sourcePath,
		})

		for (const cssPath of affectedCssPaths) {
			scheduleDiagnostics(cssPath)
		}
	}

	function createRestartCodeAction(): CodeAction {
		return {
			command: {
				command: LASERTAG_RESTART_SERVER_COMMAND,
				title: LASERTAG_RESTART_SERVER_TITLE,
			},
			kind: CodeActionKind.QuickFix,
			title: LASERTAG_RESTART_SERVER_TITLE,
		}
	}

	function createCodeActions(params: CodeActionParams): CodeAction[] {
		const filePath = filePathFromUri(params.textDocument.uri)
		const requestedKinds = params.context.only

		if (
			!filePath ||
			(!isCssModulePath(filePath) && !isRenderSourcePath(filePath))
		) {
			return []
		}

		const actions = shouldIncludeCodeActionKind(
			CodeActionKind.QuickFix,
			requestedKinds,
		)
			? [createRestartCodeAction()]
			: []

		if (!isCssModulePath(filePath)) return actions

		const document = documents.get(params.textDocument.uri)

		if (!document) return actions

		const cleanUpActionKind = cleanUpDeadSelectorsKindForRequest(requestedKinds)

		if (cleanUpActionKind) {
			actions.unshift(
				createCleanUpDeadSelectorsCodeAction(
					document,
					state.getDiagnostics(filePath),
					cleanUpActionKind,
				),
			)
		}

		return actions
	}

	function createCompletions(params: CompletionParams): CompletionItem[] {
		const filePath = filePathFromUri(params.textDocument.uri)

		if (!filePath || !isCssModulePath(filePath)) return []

		const document = documents.get(params.textDocument.uri)

		if (!document) return []

		const renderStory = state.getRenderStory(filePath)

		if (!renderStory) return []

		return createCssModuleCompletionItems({
			offset: document.offsetAt(params.position),
			renderStory,
			sourceText: document.getText(),
		})
	}

	function handleChangedDocument(
		document: TextDocument,
		eventName: `changed` | `opened`,
	): void {
		const filePath = filePathFromDocument(document)

		if (!filePath) return
		if (!isCssModulePath(filePath)) navigationRevision++
		invalidateCssAnalysis()

		logger.debug(`document`, eventName, {
			filePath,
			languageId: document.languageId,
			version: document.version,
		})
		state.openDocument(createDocumentInput(document, filePath))
		scheduleOpenCss()

		if (isCssModulePath(filePath)) {
			scheduleDiagnostics(filePath)
			return
		}

		if (isRenderSourcePath(filePath)) {
			scheduleDiagnostics(filePath)
			scheduleAffectedCssForRenderSource(filePath)
		}
	}

	function handleWorkspaceFoldersChanged(
		event: WorkspaceFolderChangeEvent,
	): void {
		navigationRevision++
		navigationDiskRevision++
		invalidateCssAnalysis(true)
		void cssAnalysis.reset()
		void navigation.reset()
		const removedPaths = new Set(
			event.removed.flatMap((workspaceFolder) => {
				const filePath = filePathFromUri(workspaceFolder.uri)

				return filePath ? [filePath] : []
			}),
		)
		const addedPaths = event.added.flatMap((workspaceFolder) => {
			const filePath = filePathFromUri(workspaceFolder.uri)

			return filePath ? [filePath] : []
		})
		const startedAt = performance.now()

		workspaceFolderPaths = [
			...workspaceFolderPaths.filter(
				(workspaceFolderPath) => !removedPaths.has(workspaceFolderPath),
			),
			...addedPaths,
		]
		state.indexWorkspaceFolders(workspaceFolderPaths)
		logWorkspaceIndex(`folders changed`, startedAt)
	}

	connection.onInitialize((params) => {
		const startedAt = performance.now()
		navigationEnabled = workspaceAllowsMappers(params.initializationOptions)
		cssEnabled = workspaceAllowsMappers(params.initializationOptions)
		definitionLinkSupport =
			params.capabilities.textDocument?.definition?.linkSupport === true
		declarationLinkSupport =
			params.capabilities.textDocument?.declaration?.linkSupport === true

		clientSupportsDynamicWatchedFiles =
			params.capabilities.workspace?.didChangeWatchedFiles
				?.dynamicRegistration === true
		clientSupportsWorkspaceFolderChanges =
			clientSupportsWorkspaceFolderChangeEvents(params)
		workspaceFolderPaths = workspaceFolderPathsFromInitialize(params)
		state.indexWorkspaceFolders(workspaceFolderPaths)
		logger.info(`server`, `initialized`, {
			clientSupportsDynamicWatchedFiles,
			clientSupportsWorkspaceFolderChanges,
			debounceMs,
			logLevel: logger.getLevel(),
			rootUri: params.rootUri,
			workspaceFolderCount: workspaceFolderPaths.length,
		})
		logWorkspaceIndex(`indexed`, startedAt)

		return createInitializeResult(params)
	})
	connection.onInitialized(() => {
		if (
			(navigationEnabled || cssEnabled) &&
			clientSupportsDynamicWatchedFiles
		) {
			void connection.client
				.register(DidChangeWatchedFilesNotification.type, {
					watchers: [
						{
							globPattern: `**/*.{ts,js,jsx,mts,cts,json,jsonc}`,
							kind: allWatchedFileChangeKinds(),
						},
					],
				})
				.catch((error: unknown) =>
					logger.warn(`navigation`, `could not register dependency watchers`, {
						error: messageFromError(error),
					}),
				)
		}
		if (clientSupportsDynamicWatchedFiles) {
			logger.info(`watchers`, `registering dynamic file watchers`, {
				globPatterns: [`**/*.module.css`, `**/*.tsx`, `**/*.astro`],
			})
			void connection.client
				.register(DidChangeWatchedFilesNotification.type, {
					watchers: [
						{
							globPattern: `**/*.module.css`,
							kind: allWatchedFileChangeKinds(),
						},
						{
							globPattern: `**/*.tsx`,
							kind: allWatchedFileChangeKinds(),
						},
						{
							globPattern: `**/*.astro`,
							kind: allWatchedFileChangeKinds(),
						},
					],
				})
				.then(() => {
					logger.info(`watchers`, `registered dynamic file watchers`, {
						globPatterns: [`**/*.module.css`, `**/*.tsx`, `**/*.astro`],
					})
				})
				.catch((error: unknown) => {
					logger.warn(`watchers`, `could not register file watchers`, {
						error: messageFromError(error),
					})
				})
		} else {
			logger.info(`watchers`, `using client-synchronized file events`)
		}

		if (!clientSupportsWorkspaceFolderChanges) {
			logger.info(`workspace`, `client does not send folder changes`)
			return
		}

		try {
			connection.workspace.onDidChangeWorkspaceFolders(
				handleWorkspaceFoldersChanged,
			)
			logger.info(`workspace`, `registered folder change listener`)
		} catch (error: unknown) {
			logger.warn(`workspace`, `could not register workspace folder changes`, {
				error: messageFromError(error),
			})
		}
	})
	connection.onCodeAction(async (params, token) => {
		const filePath = filePathFromUri(params.textDocument.uri)
		if (filePath && cssEnabled && !(await ensureCssAnalysis(filePath, token)))
			return []
		return createCodeActions(params)
	})
	connection.onCompletion(async (params, token) => {
		const filePath = filePathFromUri(params.textDocument.uri)
		if (filePath && cssEnabled && !(await ensureCssAnalysis(filePath, token)))
			return []
		return createCompletions(params)
	})
	async function navigate(
		params: TextDocumentPositionParams,
		token: CancellationToken,
		kind: AstroNavigationTarget[`kind`],
	) {
		const filePath = filePathFromUri(params.textDocument.uri)
		const document = documents.get(params.textDocument.uri)
		if (
			!navigationEnabled ||
			!filePath?.endsWith(`.astro`) ||
			!document ||
			token.isCancellationRequested
		)
			return []
		// Opt-in applies to the configured workspace, not arbitrary external files.
		if (
			!workspaceFolderPaths.some((folder) => {
				const relative = path.relative(folder, filePath)
				return (
					relative !== `..` &&
					!relative.startsWith(`..${path.sep}`) &&
					!path.isAbsolute(relative)
				)
			})
		)
			return []
		const revision = navigationRevision
		const targets = await navigation.request(
			{
				filePath,
				sourceText: document.getText(),
				offset: document.offsetAt(params.position),
				diskRevision: navigationDiskRevision,
				openFiles: documents.all().flatMap((open) => {
					const name = filePathFromDocument(open)
					return name && !isCssModulePath(name)
						? [[name, open.getText()] as [string, string]]
						: []
				}),
			},
			token,
		)
		if (
			token.isCancellationRequested ||
			navigationRevision !== revision ||
			!navigationEnabled
		)
			return []
		return navigationLocations(
			targets,
			kind,
			kind === `source` ? definitionLinkSupport : declarationLinkSupport,
		)
	}
	connection.onDefinition((params, token) => navigate(params, token, `source`))
	connection.onDeclaration((params, token) =>
		navigate(params, token, `ambient`),
	)
	connection.onRequest<LasertagRenderStoryView, never>(
		LASERTAG_RENDER_STORY_REQUEST,
		async (
			params: LasertagRenderStoryRequest,
			token,
		): Promise<LasertagRenderStoryView> => {
			const filePath = filePathFromUri(params.uri)

			if (filePath && cssEnabled && !(await ensureCssAnalysis(filePath, token)))
				return { kind: `outside-context` }
			return filePath
				? state.getRenderStoryView(filePath)
				: { kind: `outside-context` as const }
		},
	)
	connection.onDidChangeWatchedFiles((event) => {
		invalidateCssAnalysis(true)
		if (event.changes.some((change) => !change.uri.endsWith(`.css`))) {
			navigationRevision++
			navigationDiskRevision++
		}
		logger.info(`watchers`, `received file changes`, {
			changeCount: event.changes.length,
		})

		for (const change of event.changes) {
			const filePath = filePathFromUri(change.uri)

			if (!filePath) continue

			const affectedCssBeforeChange = isRenderSourcePath(filePath)
				? state.getAffectedCssPathsForRenderSource(filePath)
				: []

			if (change.type === FileChangeType.Deleted) {
				state.deleteFile(filePath)
			} else {
				state.refreshDiskFile(filePath)
			}
			logger.debug(`watchers`, `processed file change`, {
				changeType: watchedFileChangeTypeName(change.type),
				filePath,
			})

			if (isCssModulePath(filePath)) {
				const isOpen = state.getOpenDocumentPaths().includes(filePath)

				if (change.type === FileChangeType.Deleted && !isOpen) {
					clearDiagnostics(filePath, change.uri)
				} else {
					scheduleDiagnostics(filePath)
				}
			}

			if (isRenderSourcePath(filePath)) {
				const isOpen = state.getOpenDocumentPaths().includes(filePath)

				if (change.type === FileChangeType.Deleted && !isOpen) {
					clearDiagnostics(filePath, change.uri)
				} else {
					scheduleDiagnostics(filePath)
				}

				const affectedCssPaths = new Set([
					...affectedCssBeforeChange,
					...state.getAffectedCssPathsForRenderSource(filePath),
				])

				logger.info(`render-source`, `file change affected css`, {
					affectedCssCount: affectedCssPaths.size,
					sourcePath: filePath,
				})

				for (const cssPath of affectedCssPaths) {
					scheduleDiagnostics(cssPath)
				}
			}
		}
		scheduleOpenCss()
	})
	documents.onDidOpen((event) =>
		handleChangedDocument(event.document, `opened`),
	)
	documents.onDidChangeContent((event) =>
		handleChangedDocument(event.document, `changed`),
	)
	documents.onDidClose((event) => {
		const filePath = filePathFromDocument(event.document)

		if (!filePath) return
		if (!isCssModulePath(filePath)) navigationRevision++
		invalidateCssAnalysis()
		if (
			!documents
				.all()
				.some((document) => filePathFromDocument(document)?.endsWith(`.astro`))
		)
			void navigation.reset()

		logger.debug(`document`, `closed`, {
			filePath,
			languageId: event.document.languageId,
			version: event.document.version,
		})
		state.closeDocument(filePath)
		scheduleOpenCss()
		if (!hasOpenCssContext()) {
			cssRequests.clear()
			void cssAnalysis.reset()
		}

		if (isCssModulePath(filePath)) {
			clearDiagnostics(filePath, event.document.uri)
		}

		if (isRenderSourcePath(filePath)) {
			scheduleDiagnostics(filePath)
			scheduleAffectedCssForRenderSource(filePath)
		}
	})
	documents.listen(connection)

	return {
		connection,
		documents,
		listen: () => connection.listen(),
		logger,
		state,
	}
}

if (import.meta.main && process.argv.includes(`--${CSS_ANALYSIS_WORKER}`)) {
	runCssAnalysisWorker()
} else if (
	import.meta.main &&
	process.argv.includes(`--${ASTRO_NAVIGATION_WORKER}`)
) {
	runAstroNavigationWorker()
} else if (import.meta.main) {
	const server = createLasertagLspServer()

	registerProcessCrashLogging(server.logger)
	server.listen()
}
