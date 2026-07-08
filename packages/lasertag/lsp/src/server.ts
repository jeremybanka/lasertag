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

export type LasertagLspReadOptions = {
	cssPath?: string
	fileExists?: (filePath: string) => boolean
	readFile?: (filePath: string) => string
}

export type LasertagLspServerOptions = LasertagLspStateEnvironment & {
	debounceMs?: number
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
	_params?: InitializeParams,
): InitializeResult {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
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

export function createLasertagLspServer(
	options: LasertagLspServerOptions = {},
) {
	const connection = createConnection()
	const documents = new TextDocuments(TextDocument)
	const state = createLasertagLspState(options)
	const debounceMs = options.debounceMs ?? 75
	const diagnosticSubscriptions = new Map<string, () => void>()
	const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>()
	let clientSupportsDynamicWatchedFiles = false
	let workspaceFolderPaths: string[] = []

	function clearPendingDiagnostics(cssPath: string): void {
		const timer = diagnosticTimers.get(cssPath)

		if (timer) {
			clearTimeout(timer)
			diagnosticTimers.delete(cssPath)
		}
	}

	function publishDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath)) return

		void connection.sendDiagnostics({
			diagnostics: state.getDiagnostics(cssPath),
			uri: state.getDocumentUri(cssPath),
		})
	}

	function scheduleDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath)) return

		clearPendingDiagnostics(cssPath)

		if (debounceMs <= 0) {
			publishDiagnostics(cssPath)
			return
		}

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
	}

	function unsubscribeFromCssDiagnostics(cssPath: string): void {
		const unsubscribe = diagnosticSubscriptions.get(cssPath)

		if (!unsubscribe) return

		unsubscribe()
		diagnosticSubscriptions.delete(cssPath)
	}

	function subscribeToCssDiagnostics(cssPath: string): void {
		if (!isCssModulePath(cssPath) || diagnosticSubscriptions.has(cssPath))
			return

		diagnosticSubscriptions.set(
			cssPath,
			state.subscribeToCssDiagnostics(cssPath, () =>
				scheduleDiagnostics(cssPath),
			),
		)
	}

	function scheduleAffectedCssForTsx(tsxPath: string): void {
		for (const cssPath of state.getAffectedCssPathsForTsx(tsxPath)) {
			subscribeToCssDiagnostics(cssPath)
			scheduleDiagnostics(cssPath)
		}
	}

	function handleChangedDocument(document: TextDocument): void {
		const filePath = filePathFromDocument(document)

		if (!filePath) return

		state.openDocument(createDocumentInput(document, filePath))

		if (isCssModulePath(filePath)) {
			subscribeToCssDiagnostics(filePath)
			scheduleDiagnostics(filePath)
			return
		}

		if (isTsxPath(filePath)) scheduleAffectedCssForTsx(filePath)
	}

	connection.onInitialize((params) => {
		clientSupportsDynamicWatchedFiles =
			params.capabilities.workspace?.didChangeWatchedFiles
				?.dynamicRegistration === true
		workspaceFolderPaths = workspaceFolderPathsFromInitialize(params)
		state.indexWorkspaceFolders(workspaceFolderPaths)

		return createInitializeResult(params)
	})
	connection.onInitialized(() => {
		if (!clientSupportsDynamicWatchedFiles) return

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
			.catch((error: unknown) => {
				connection.console.warn(
					`lasertag-lsp could not register file watchers: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			})
	})
	connection.onDidChangeWatchedFiles((event) => {
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
				for (const cssPath of new Set([
					...affectedCssBeforeChange,
					...state.getAffectedCssPathsForTsx(filePath),
				])) {
					subscribeToCssDiagnostics(cssPath)
					scheduleDiagnostics(cssPath)
				}
			}
		}
	})
	connection.workspace.onDidChangeWorkspaceFolders((event) => {
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

		workspaceFolderPaths = [
			...workspaceFolderPaths.filter(
				(workspaceFolderPath) => !removedPaths.has(workspaceFolderPath),
			),
			...addedPaths,
		]
		state.indexWorkspaceFolders(workspaceFolderPaths)
	})
	documents.onDidOpen((event) => handleChangedDocument(event.document))
	documents.onDidChangeContent((event) => handleChangedDocument(event.document))
	documents.onDidClose((event) => {
		const filePath = filePathFromDocument(event.document)

		if (!filePath) return

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
