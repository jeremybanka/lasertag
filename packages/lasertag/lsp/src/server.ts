#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"

import {
	createConnection,
	DiagnosticSeverity,
	Files,
	type Diagnostic,
	type InitializeResult,
	TextDocumentSyncKind,
	TextDocuments,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	validateCssReachability,
	type CssReachabilityDiagnostic,
} from "../../refractor/src/index.ts"

export type LasertagLspReadOptions = {
	cssPath?: string
	fileExists?: (filePath: string) => boolean
	readFile?: (filePath: string) => string
}

export function isCssModulePath(filePath: string): boolean {
	return filePath.endsWith(`.module.css`)
}

export function findSiblingTsxPath(
	cssPath: string,
	fileExists: (filePath: string) => boolean = existsSync,
): string | undefined {
	if (!isCssModulePath(cssPath)) return

	const stemPath = cssPath.slice(0, -`.module.css`.length)
	const candidate = `${stemPath}.tsx`

	return fileExists(candidate) ? candidate : undefined
}

function getDocumentFilePath(
	document: TextDocument,
	options: LasertagLspReadOptions,
): string | undefined {
	return options.cssPath ?? Files.uriToFilePath(document.uri) ?? undefined
}

function toLspDiagnostic(
	document: TextDocument,
	diagnostic: CssReachabilityDiagnostic,
): Diagnostic {
	const startOffset = diagnostic.range?.start ?? 0
	const endOffset = diagnostic.range?.end ?? startOffset

	return {
		code: diagnostic.code,
		message: diagnostic.message,
		range: {
			start: document.positionAt(startOffset),
			end: document.positionAt(endOffset),
		},
		severity: DiagnosticSeverity.Warning,
		source: `lasertag`,
	}
}

export function createRefractorDiagnostics(
	document: TextDocument,
	options: LasertagLspReadOptions = {},
): Diagnostic[] {
	const cssPath = getDocumentFilePath(document, options)

	if (!cssPath || !isCssModulePath(cssPath)) return []

	const fileExists = options.fileExists ?? existsSync
	const readFile =
		options.readFile ?? ((filePath) => readFileSync(filePath, `utf-8`))
	const tsxPath = findSiblingTsxPath(cssPath, fileExists)

	if (!tsxPath) return []

	const result = validateCssReachability({
		cssPath,
		cssSource: document.getText(),
		tsxPath,
		tsxSource: readFile(tsxPath),
	})

	return result.diagnostics.map((diagnostic) =>
		toLspDiagnostic(document, diagnostic),
	)
}

export function createInitializeResult(): InitializeResult {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
		},
		serverInfo: {
			name: `lasertag-lsp`,
		},
	}
}

export function createLasertagLspServer() {
	const connection = createConnection()
	const documents = new TextDocuments(TextDocument)

	function publishDiagnostics(document: TextDocument) {
		void connection.sendDiagnostics({
			diagnostics: createRefractorDiagnostics(document),
			uri: document.uri,
		})
	}

	connection.onInitialize(createInitializeResult)
	documents.onDidOpen((event) => publishDiagnostics(event.document))
	documents.onDidChangeContent((event) => publishDiagnostics(event.document))
	documents.onDidClose((event) => {
		void connection.sendDiagnostics({
			diagnostics: [],
			uri: event.document.uri,
		})
	})
	documents.listen(connection)

	return {
		connection,
		documents,
		listen: () => connection.listen(),
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	createLasertagLspServer().listen()
}
