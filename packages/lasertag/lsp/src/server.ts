#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"

import {
	createConnection,
	DidChangeWatchedFilesNotification,
	FileChangeType,
	Files,
	type Diagnostic,
	type InitializeParams,
	type InitializeResult,
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
	type LasertagLspStateEnvironment,
	type LspDocumentInput,
} from "./state.ts"
import {
	createLasertagLspLogger,
	logLevelFromEnvironment,
	type LasertagLspLogger,
	type LasertagLspLogLevel,
} from "./logger.ts"

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
	const diagnosticSubscriptions = new Map<string, () => void>()
	const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>()
	let clientSupportsDynamicWatchedFiles = false
	let clientSupportsWorkspaceFolderChanges = false
	let workspaceFolderPaths: string[] = []

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

	function unsubscribeFromCssDiagnostics(cssPath: string): void {
		const unsubscribe = diagnosticSubscriptions.get(cssPath)

		if (!unsubscribe) return

		unsubscribe()
		diagnosticSubscriptions.delete(cssPath)
		logger.debug(`diagnostics`, `unsubscribed`, { cssPath })
	}

	function subscribeToCssDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath) || diagnosticSubscriptions.has(cssPath))
			return

		logger.debug(`diagnostics`, `subscribing`, { cssPath })
		diagnosticSubscriptions.set(
			cssPath,
			state.subscribeToCssDiagnostics(cssPath, () =>
				scheduleDiagnostics(cssPath),
			),
		)
	}

	function scheduleAffectedCssForTsx(tsxPath: string): void {
		const affectedCssPaths = state.getAffectedCssPathsForTsx(tsxPath)

		logger.info(`tsx`, `scheduling affected css`, {
			affectedCssCount: affectedCssPaths.length,
			tsxPath,
		})

		for (const cssPath of affectedCssPaths) {
			subscribeToCssDiagnostics(cssPath)
			scheduleDiagnostics(cssPath)
		}
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
			subscribeToCssDiagnostics(filePath)
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
					unsubscribeFromCssDiagnostics(filePath)
					clearDiagnostics(filePath, change.uri)
				} else {
					subscribeToCssDiagnostics(filePath)
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
					subscribeToCssDiagnostics(cssPath)
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
			unsubscribeFromCssDiagnostics(filePath)
			clearDiagnostics(filePath, event.document.uri)
		}

		if (isTsxPath(filePath)) scheduleAffectedCssForTsx(filePath)
	})
	documents.listen(connection)

	return {
		connection,
		documents,
		listen: () => connection.listen(),
		state,
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	createLasertagLspServer().listen()
}
