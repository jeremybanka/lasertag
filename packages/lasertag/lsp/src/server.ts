#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"

import {
	CodeActionKind,
	createConnection,
	DidChangeWatchedFilesNotification,
	FileChangeType,
	Files,
	type CodeAction,
	type CodeActionParams,
	type Diagnostic,
	type InitializeParams,
	type InitializeResult,
	type TextEdit,
	TextDocumentSyncKind,
	TextDocuments,
	WatchKind,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	createLasertagLspState,
	findSiblingTsxPathFromConvention,
	isCssModulePath as isCssModuleFilePath,
	isTsxPath,
	offsetToPosition,
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
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
	LASERTAG_RESTART_SERVER_COMMAND,
	LASERTAG_RESTART_SERVER_TITLE,
	type OffsetRange,
} from "./code-actions.ts"

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
	const cssPath = getDocumentFilePath(document, options)

	if (!cssPath || !isCssModulePath(cssPath)) return []

	const state = createLasertagLspState({
		fileExists: options.fileExists ?? existsSync,
		readFile:
			options.readFile ?? ((filePath) => readFileSync(filePath, `utf-8`)),
	})

	state.openDocument(createDocumentInput(document, cssPath))

	return state.getDiagnostics(cssPath)
}

export function createInitializeResult(
	params?: InitializeParams,
): InitializeResult {
	return {
		capabilities: {
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix],
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

function isLasertagDeadSelectorDiagnostic(diagnostic: Diagnostic): boolean {
	return (
		diagnostic.source === `lasertag` &&
		(diagnostic.code === `dead-selector` ||
			diagnostic.code === `impossible-local-class`)
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

	connection.onShutdown(() => {
		logger.info(`server`, `shutdown requested`)
	})
	connection.onExit(() => {
		logger.warn(`server`, `exit notification received`)
		writeServerEventToStderr(`exit notification received`)
	})

	function logWorkspaceIndex(event: string, startedAt: number): void {
		logger.info(`workspace`, event, {
			cssModuleCount: state.getKnownCssModulePaths().length,
			durationMs: durationMs(startedAt),
			tsxCount: state.getWatchedTsxPaths().length,
			workspaceFolderCount: workspaceFolderPaths.length,
		})
	}

	function clearPendingDiagnostics(cssPath: string): void {
		const timer = diagnosticTimers.get(cssPath)

		if (timer) {
			clearTimeout(timer)
			diagnosticTimers.delete(cssPath)
			logger.debug(`diagnostics`, `cleared pending timer`, { cssPath })
		}
	}

	function publishDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath)) return

		const startedAt = performance.now()
		const diagnostics = state.getDiagnostics(cssPath)
		const uri = state.getDocumentUri(cssPath)

		void connection.sendDiagnostics({
			diagnostics,
			uri,
		})
		logger.info(`diagnostics`, `published`, {
			cssPath,
			diagnosticCount: diagnostics.length,
			durationMs: durationMs(startedAt),
			uri,
		})
	}

	function scheduleDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath)) return

		clearPendingDiagnostics(cssPath)

		if (debounceMs <= 0) {
			logger.debug(`diagnostics`, `publishing immediately`, { cssPath })
			publishDiagnostics(cssPath)
			return
		}

		logger.debug(`diagnostics`, `scheduled`, { cssPath, debounceMs })
		diagnosticTimers.set(
			cssPath,
			setTimeout(() => {
				diagnosticTimers.delete(cssPath)
				publishDiagnostics(cssPath)
			}, debounceMs),
		)
	}

	function clearDiagnostics(
		cssPath: string,
		uri = state.getDocumentUri(cssPath),
	): void {
		clearPendingDiagnostics(cssPath)
		void connection.sendDiagnostics({
			diagnostics: [],
			uri,
		})
		logger.info(`diagnostics`, `cleared`, { cssPath, uri })
	}

	function scheduleAffectedCssForTsx(tsxPath: string): void {
		const affectedCssPaths = state.getAffectedCssPathsForTsx(tsxPath)

		logger.info(`tsx`, `scheduling affected css`, {
			affectedCssCount: affectedCssPaths.length,
			tsxPath,
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

	function createCleanUpDeadSelectorsCodeAction(
		document: TextDocument,
		diagnostics: Diagnostic[],
	): CodeAction | undefined {
		const deadSelectorDiagnostics = diagnostics.filter(
			isLasertagDeadSelectorDiagnostic,
		)

		if (deadSelectorDiagnostics.length === 0) return

		const sourceText = document.getText()
		const cleanupRanges = createDeadSelectorCleanupRanges(
			sourceText,
			deadSelectorDiagnostics.map((diagnostic) =>
				diagnosticToOffsetRange(document, diagnostic),
			),
		)

		if (cleanupRanges.length === 0) return

		return {
			diagnostics: deadSelectorDiagnostics,
			edit: {
				changes: {
					[document.uri]: cleanupRanges.map((range) =>
						createDeleteTextEdit(sourceText, range),
					),
				},
			},
			kind: CodeActionKind.QuickFix,
			title: LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
		}
	}

	function createCodeActions(params: CodeActionParams): CodeAction[] {
		const filePath = filePathFromUri(params.textDocument.uri)

		if (!filePath || (!isCssModulePath(filePath) && !isTsxPath(filePath))) {
			return []
		}

		const actions = [createRestartCodeAction()]

		if (!isCssModulePath(filePath)) return actions

		const document = documents.get(params.textDocument.uri)

		if (!document) return actions

		const cleanUpAction = createCleanUpDeadSelectorsCodeAction(
			document,
			state.getDiagnostics(filePath),
		)

		if (cleanUpAction) actions.unshift(cleanUpAction)

		return actions
	}

	function handleChangedDocument(
		document: TextDocument,
		eventName: `changed` | `opened`,
	): void {
		const filePath = filePathFromDocument(document)

		if (!filePath) return

		logger.debug(`document`, eventName, {
			filePath,
			languageId: document.languageId,
			version: document.version,
		})
		state.openDocument(createDocumentInput(document, filePath))

		if (isCssModulePath(filePath)) {
			scheduleDiagnostics(filePath)
			return
		}

		if (isTsxPath(filePath)) scheduleAffectedCssForTsx(filePath)
	}

	function handleWorkspaceFoldersChanged(
		event: WorkspaceFolderChangeEvent,
	): void {
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
		if (clientSupportsDynamicWatchedFiles) {
			logger.info(`watchers`, `registering dynamic file watchers`, {
				globPatterns: [`**/*.module.css`, `**/*.tsx`],
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
					],
				})
				.then(() => {
					logger.info(`watchers`, `registered dynamic file watchers`, {
						globPatterns: [`**/*.module.css`, `**/*.tsx`],
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
	connection.onCodeAction(createCodeActions)
	connection.onDidChangeWatchedFiles((event) => {
		logger.info(`watchers`, `received file changes`, {
			changeCount: event.changes.length,
		})

		for (const change of event.changes) {
			const filePath = filePathFromUri(change.uri)

			if (!filePath) continue

			const affectedCssBeforeChange = isTsxPath(filePath)
				? state.getAffectedCssPathsForTsx(filePath)
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

			if (isTsxPath(filePath)) {
				const affectedCssPaths = new Set([
					...affectedCssBeforeChange,
					...state.getAffectedCssPathsForTsx(filePath),
				])

				logger.info(`tsx`, `file change affected css`, {
					affectedCssCount: affectedCssPaths.size,
					tsxPath: filePath,
				})

				for (const cssPath of affectedCssPaths) {
					scheduleDiagnostics(cssPath)
				}
			}
		}
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

		logger.debug(`document`, `closed`, {
			filePath,
			languageId: event.document.languageId,
			version: event.document.version,
		})
		state.closeDocument(filePath)

		if (isCssModulePath(filePath)) {
			clearDiagnostics(filePath, event.document.uri)
		}

		if (isTsxPath(filePath)) scheduleAffectedCssForTsx(filePath)
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

if (import.meta.url === `file://${process.argv[1]}`) {
	const server = createLasertagLspServer()

	registerProcessCrashLogging(server.logger)
	server.listen()
}
