import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
	atom,
	atomFamily,
	selector,
	selectorFamily,
	Silo,
	transaction,
} from "atom.io"
import { globSync } from "tinyglobby"
import {
	DiagnosticSeverity,
	type Diagnostic,
	type Position,
} from "vscode-languageserver/node"

import {
	analyzeCssModuleSelectors,
	analyzeTsxRenderStory,
	createCssReachabilityDiagnostics,
	type CssReachabilityDiagnostic,
	type CssSelectorAnalysis,
	type RenderStory,
} from "../refractor/index.ts"

const CSS_MODULE_SUFFIX = `.module.css`
const TSX_SUFFIX = `.tsx`
const WATCHED_CSS_PATTERN = `**/*.module.css`
const WATCHED_TSX_PATTERN = `**/*.tsx`
const DEFAULT_IGNORE_PATTERNS = [
	`**/node_modules/**`,
	`**/dist/**`,
	`**/build/**`,
	`**/coverage/**`,
	`**/refractor/corpus/providers/**`,
]

export type FileSnapshot = {
	exists: boolean
	revision: number
	text: string
}

export type LspDocumentInput = {
	languageId: string
	path: string
	text: string
	uri: string
	version: number
}

type OpenDocument = Omit<LspDocumentInput, "path">

type RenderStoryAnalysis =
	| {
			kind: `ready`
			renderStory: RenderStory
	  }
	| {
			kind: `missing` | `error`
			message?: string
	  }

type CssSelectorAnalysisState =
	| {
			kind: `ready`
			selectorAnalyses: CssSelectorAnalysis[]
	  }
	| {
			kind: `missing` | `error`
			message?: string
	  }

export type LasertagLspStateEnvironment = {
	cwd?: string
	fileExists?: (filePath: string) => boolean
	glob?: typeof globSync
	readFile?: (filePath: string) => string
}

type WorkspaceIndexInput = {
	cssPaths: string[]
	tsxPaths: string[]
	workspaceFolderPaths: string[]
}

type DiskSnapshotInput = {
	path: string
	snapshot: FileSnapshot
}

const missingSnapshot = (): FileSnapshot => ({
	exists: false,
	revision: 0,
	text: ``,
})

export function isCssModulePath(filePath: string): boolean {
	return filePath.endsWith(CSS_MODULE_SUFFIX)
}

export function isTsxPath(filePath: string): boolean {
	return filePath.endsWith(TSX_SUFFIX)
}

export function findSiblingTsxPathFromConvention(
	cssPath: string,
): string | undefined {
	if (!isCssModulePath(cssPath)) return

	return `${cssPath.slice(0, -CSS_MODULE_SUFFIX.length)}${TSX_SUFFIX}`
}

export function findSiblingCssModulePathFromConvention(
	tsxPath: string,
): string | undefined {
	if (!isTsxPath(tsxPath)) return

	return `${tsxPath.slice(0, -TSX_SUFFIX.length)}${CSS_MODULE_SUFFIX}`
}

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function uniqueSorted(paths: Iterable<string>): string[] {
	return [...new Set(paths)].toSorted()
}

function addPath(paths: readonly string[], filePath: string): string[] {
	return uniqueSorted([...paths, filePath])
}

function removePath(paths: readonly string[], filePath: string): string[] {
	return paths.filter((pathItem) => pathItem !== filePath)
}

export function offsetToPosition(
	sourceText: string,
	rawOffset: number,
): Position {
	const offset = Math.max(0, Math.min(rawOffset, sourceText.length))
	let line = 0
	let character = 0

	for (let index = 0; index < offset; index += 1) {
		if (sourceText[index] === `\n`) {
			line += 1
			character = 0
			continue
		}

		character += 1
	}

	return { character, line }
}

export function mapRefractorDiagnosticToLsp(
	cssSource: string,
	diagnostic: CssReachabilityDiagnostic,
): Diagnostic {
	const startOffset = diagnostic.range?.start ?? 0
	const endOffset = diagnostic.range?.end ?? startOffset

	return {
		code: diagnostic.code,
		message: diagnostic.message,
		range: {
			start: offsetToPosition(cssSource, startOffset),
			end: offsetToPosition(cssSource, endOffset),
		},
		severity: DiagnosticSeverity.Warning,
		source: `lasertag`,
	}
}

const workspaceFolderPathsAtom = atom<string[]>({
	default: [],
	key: `lasertag/lsp/workspace-folder-paths`,
})

const watchedCssModulePathsAtom = atom<string[]>({
	default: [],
	key: `lasertag/lsp/watched-css-module-paths`,
})

const watchedTsxPathsAtom = atom<string[]>({
	default: [],
	key: `lasertag/lsp/watched-tsx-paths`,
})

const openDocumentPathsAtom = atom<string[]>({
	default: [],
	key: `lasertag/lsp/open-document-paths`,
})

const openDocumentAtoms = atomFamily<OpenDocument | null, string>({
	default: null,
	key: `lasertag/lsp/open-document`,
})

const diskFileSnapshotAtoms = atomFamily<FileSnapshot, string>({
	default: missingSnapshot,
	key: `lasertag/lsp/disk-file-snapshot`,
})

const knownCssModulePathsSelector = selector<string[]>({
	get: ({ get }) => {
		const watchedCssPaths = get(watchedCssModulePathsAtom)
		const openCssPaths = get(openDocumentPathsAtom).filter(isCssModulePath)

		return uniqueSorted([...watchedCssPaths, ...openCssPaths])
	},
	key: `lasertag/lsp/known-css-module-paths`,
})

const fileSnapshotSelectors = selectorFamily<FileSnapshot, string>({
	get:
		(filePath) =>
		({ get }) => {
			const openDocument = get(openDocumentAtoms, filePath)

			if (openDocument) {
				return {
					exists: true,
					revision: openDocument.version,
					text: openDocument.text,
				}
			}

			return get(diskFileSnapshotAtoms, filePath)
		},
	key: `lasertag/lsp/file-snapshot`,
})

const fileTextSelectors = selectorFamily<string | null, string>({
	get:
		(filePath) =>
		({ get }) => {
			const snapshot = get(fileSnapshotSelectors, filePath)

			return snapshot.exists ? snapshot.text : null
		},
	key: `lasertag/lsp/file-text`,
})

const documentUriSelectors = selectorFamily<string, string>({
	get:
		(filePath) =>
		({ get }) => {
			const openDocument = get(openDocumentAtoms, filePath)

			return openDocument?.uri ?? pathToFileURL(filePath).href
		},
	key: `lasertag/lsp/document-uri`,
})

const siblingTsxPathSelectors = selectorFamily<string | null, string>({
	get:
		(cssPath) =>
		({ get }) => {
			const candidate = findSiblingTsxPathFromConvention(cssPath)

			if (!candidate) return null

			const snapshot = get(fileSnapshotSelectors, candidate)

			return snapshot.exists ? candidate : null
		},
	key: `lasertag/lsp/sibling-tsx-path`,
})

const renderStorySelectors = selectorFamily<RenderStoryAnalysis, string>({
	get:
		(tsxPath) =>
		({ get }) => {
			const tsxSource = get(fileTextSelectors, tsxPath)

			if (tsxSource === null) return { kind: `missing` }

			try {
				return {
					kind: `ready`,
					renderStory: analyzeTsxRenderStory({
						filePath: tsxPath,
						sourceText: tsxSource,
					}),
				}
			} catch (error) {
				return {
					kind: `error`,
					message: messageFromError(error),
				}
			}
		},
	key: `lasertag/lsp/render-story`,
})

const cssSelectorAnalysisSelectors = selectorFamily<
	CssSelectorAnalysisState,
	string
>({
	get:
		(cssPath) =>
		({ get }) => {
			const cssSource = get(fileTextSelectors, cssPath)

			if (cssSource === null) return { kind: `missing` }

			try {
				return {
					kind: `ready`,
					selectorAnalyses: analyzeCssModuleSelectors(cssSource),
				}
			} catch (error) {
				return {
					kind: `error`,
					message: messageFromError(error),
				}
			}
		},
	key: `lasertag/lsp/css-selector-analysis`,
})

const refractorDiagnosticSelectors = selectorFamily<
	CssReachabilityDiagnostic[],
	string
>({
	get:
		(cssPath) =>
		({ get }) => {
			if (!isCssModulePath(cssPath)) return []

			const selectorAnalysis = get(cssSelectorAnalysisSelectors, cssPath)

			if (selectorAnalysis.kind !== `ready`) return []

			const tsxPath = get(siblingTsxPathSelectors, cssPath)

			if (tsxPath === null) return []

			const renderStoryAnalysis = get(renderStorySelectors, tsxPath)

			if (renderStoryAnalysis.kind !== `ready`) return []

			return createCssReachabilityDiagnostics({
				renderStory: renderStoryAnalysis.renderStory,
				selectorAnalyses: selectorAnalysis.selectorAnalyses,
			})
		},
	key: `lasertag/lsp/refractor-diagnostics`,
})

const lspDiagnosticSelectors = selectorFamily<Diagnostic[], string>({
	get:
		(cssPath) =>
		({ get }) => {
			const cssSource = get(fileTextSelectors, cssPath) ?? ``
			const diagnostics = get(refractorDiagnosticSelectors, cssPath)

			return diagnostics.map((diagnostic) =>
				mapRefractorDiagnosticToLsp(cssSource, diagnostic),
			)
		},
	key: `lasertag/lsp/lsp-diagnostics`,
})

const affectedCssPathsByTsxPathSelectors = selectorFamily<string[], string>({
	get:
		(tsxPath) =>
		({ get }) => {
			const candidate = findSiblingCssModulePathFromConvention(tsxPath)

			if (!candidate) return []

			return get(knownCssModulePathsSelector).filter(
				(cssPath) => cssPath === candidate,
			)
		},
	key: `lasertag/lsp/affected-css-paths-by-tsx-path`,
})

const indexWorkspaceFilesTransaction = transaction({
	do: (
		{ set },
		{ cssPaths, tsxPaths, workspaceFolderPaths }: WorkspaceIndexInput,
	) => {
		set(workspaceFolderPathsAtom, uniqueSorted(workspaceFolderPaths))
		set(watchedCssModulePathsAtom, uniqueSorted(cssPaths))
		set(watchedTsxPathsAtom, uniqueSorted(tsxPaths))
	},
	key: `lasertag/lsp/index-workspace-files`,
})

const upsertOpenDocumentTransaction = transaction({
	do: (
		{ get, set },
		{ languageId, path: filePath, text, uri, version }: LspDocumentInput,
	) => {
		set(openDocumentAtoms, filePath, {
			languageId,
			text,
			uri,
			version,
		})
		set(openDocumentPathsAtom, addPath(get(openDocumentPathsAtom), filePath))

		if (isCssModulePath(filePath)) {
			set(
				watchedCssModulePathsAtom,
				addPath(get(watchedCssModulePathsAtom), filePath),
			)
		}

		if (isTsxPath(filePath)) {
			set(watchedTsxPathsAtom, addPath(get(watchedTsxPathsAtom), filePath))
		}
	},
	key: `lasertag/lsp/upsert-open-document`,
})

const closeDocumentTransaction = transaction({
	do: ({ get, set }, filePath: string) => {
		set(openDocumentAtoms, filePath, null)
		set(openDocumentPathsAtom, removePath(get(openDocumentPathsAtom), filePath))
	},
	key: `lasertag/lsp/close-document`,
})

const refreshDiskFileTransaction = transaction({
	do: ({ get, set }, { path: filePath, snapshot }: DiskSnapshotInput) => {
		set(diskFileSnapshotAtoms, filePath, snapshot)

		if (isCssModulePath(filePath)) {
			const currentPaths = get(watchedCssModulePathsAtom)
			set(
				watchedCssModulePathsAtom,
				snapshot.exists
					? addPath(currentPaths, filePath)
					: removePath(currentPaths, filePath),
			)
		}

		if (isTsxPath(filePath)) {
			const currentPaths = get(watchedTsxPathsAtom)
			set(
				watchedTsxPathsAtom,
				snapshot.exists
					? addPath(currentPaths, filePath)
					: removePath(currentPaths, filePath),
			)
		}
	},
	key: `lasertag/lsp/refresh-disk-file`,
})

function createSilo(): Silo {
	const silo = new Silo({
		isProduction: true,
		lifespan: `ephemeral`,
		name: `lasertag-lsp`,
	})

	silo.install([
		workspaceFolderPathsAtom,
		watchedCssModulePathsAtom,
		watchedTsxPathsAtom,
		openDocumentPathsAtom,
		openDocumentAtoms,
		diskFileSnapshotAtoms,
		knownCssModulePathsSelector,
		fileSnapshotSelectors,
		fileTextSelectors,
		documentUriSelectors,
		siblingTsxPathSelectors,
		renderStorySelectors,
		cssSelectorAnalysisSelectors,
		refractorDiagnosticSelectors,
		lspDiagnosticSelectors,
		affectedCssPathsByTsxPathSelectors,
		indexWorkspaceFilesTransaction,
		upsertOpenDocumentTransaction,
		closeDocumentTransaction,
		refreshDiskFileTransaction,
	])

	return silo
}

export function createLasertagLspState(
	environment: LasertagLspStateEnvironment = {},
) {
	const cwd = environment.cwd ?? process.cwd()
	const fileExists = environment.fileExists ?? existsSync
	const readFile =
		environment.readFile ??
		((filePath: string) => readFileSync(filePath, `utf-8`))
	const glob = environment.glob ?? globSync
	const silo = createSilo()
	const runIndexWorkspaceFiles = silo.runTransaction(
		indexWorkspaceFilesTransaction,
	)
	const runUpsertOpenDocument = silo.runTransaction(
		upsertOpenDocumentTransaction,
	)
	const runCloseDocument = silo.runTransaction(closeDocumentTransaction)
	const runRefreshDiskFile = silo.runTransaction(refreshDiskFileTransaction)

	function normalizeFilePath(filePath: string): string {
		return path.normalize(
			path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath),
		)
	}

	function normalizePaths(paths: string[]): string[] {
		return uniqueSorted(paths.map(normalizeFilePath))
	}

	function readDiskSnapshot(filePath: string): FileSnapshot {
		const previousSnapshot = silo.getState(diskFileSnapshotAtoms, filePath)
		const revision = previousSnapshot.revision + 1

		if (!fileExists(filePath)) {
			return {
				exists: false,
				revision,
				text: ``,
			}
		}

		try {
			return {
				exists: true,
				revision,
				text: readFile(filePath),
			}
		} catch {
			return {
				exists: false,
				revision,
				text: ``,
			}
		}
	}

	function isOpen(filePath: string): boolean {
		return silo.getState(openDocumentAtoms, filePath) !== null
	}

	function refreshDiskFile(filePath: string): void {
		const normalizedPath = normalizeFilePath(filePath)

		runRefreshDiskFile({
			path: normalizedPath,
			snapshot: readDiskSnapshot(normalizedPath),
		})
	}

	function ensureFileSnapshot(filePath: string): void {
		const normalizedPath = normalizeFilePath(filePath)

		if (!isOpen(normalizedPath)) refreshDiskFile(normalizedPath)
	}

	function ensureCssDependencies(cssPath: string): void {
		const normalizedCssPath = normalizeFilePath(cssPath)

		if (!isCssModulePath(normalizedCssPath)) return

		ensureFileSnapshot(normalizedCssPath)

		const tsxPath = findSiblingTsxPathFromConvention(normalizedCssPath)

		if (tsxPath) ensureFileSnapshot(tsxPath)
	}

	function discoverWorkspaceFiles(workspaceFolderPaths: string[]) {
		const cssPaths: string[] = []
		const tsxPaths: string[] = []

		for (const workspaceFolderPath of workspaceFolderPaths) {
			const normalizedWorkspacePath = normalizeFilePath(workspaceFolderPath)

			cssPaths.push(
				...glob(WATCHED_CSS_PATTERN, {
					absolute: true,
					cwd: normalizedWorkspacePath,
					ignore: DEFAULT_IGNORE_PATTERNS,
					onlyFiles: true,
				}).map(normalizeFilePath),
			)
			tsxPaths.push(
				...glob(WATCHED_TSX_PATTERN, {
					absolute: true,
					cwd: normalizedWorkspacePath,
					ignore: DEFAULT_IGNORE_PATTERNS,
					onlyFiles: true,
				}).map(normalizeFilePath),
			)
		}

		return {
			cssPaths: uniqueSorted(cssPaths),
			tsxPaths: uniqueSorted(tsxPaths),
		}
	}

	function indexWorkspaceFolders(workspaceFolderPaths: string[]): void {
		const normalizedWorkspaceFolderPaths = normalizePaths(workspaceFolderPaths)
		const { cssPaths, tsxPaths } = discoverWorkspaceFiles(
			normalizedWorkspaceFolderPaths,
		)

		runIndexWorkspaceFiles({
			cssPaths,
			tsxPaths,
			workspaceFolderPaths: normalizedWorkspaceFolderPaths,
		})
	}

	return {
		closeDocument(filePath: string): void {
			const normalizedPath = normalizeFilePath(filePath)

			runCloseDocument(normalizedPath)
			refreshDiskFile(normalizedPath)
		},
		deleteFile(filePath: string): void {
			const normalizedPath = normalizeFilePath(filePath)
			const previousSnapshot = silo.getState(
				diskFileSnapshotAtoms,
				normalizedPath,
			)

			runRefreshDiskFile({
				path: normalizedPath,
				snapshot: {
					exists: false,
					revision: previousSnapshot.revision + 1,
					text: ``,
				},
			})
		},
		getAffectedCssPathsForTsx(tsxPath: string): string[] {
			return [
				...silo.getState(
					affectedCssPathsByTsxPathSelectors,
					normalizeFilePath(tsxPath),
				),
			]
		},
		getDiagnostics(cssPath: string): Diagnostic[] {
			const normalizedPath = normalizeFilePath(cssPath)

			ensureCssDependencies(normalizedPath)

			return [...silo.getState(lspDiagnosticSelectors, normalizedPath)]
		},
		getDocumentUri(filePath: string): string {
			return silo.getState(documentUriSelectors, normalizeFilePath(filePath))
		},
		getKnownCssModulePaths(): string[] {
			return [...silo.getState(knownCssModulePathsSelector)]
		},
		getOpenDocumentPaths(): string[] {
			return [...silo.getState(openDocumentPathsAtom)]
		},
		getRenderStory(cssPath: string): RenderStory | undefined {
			const normalizedPath = normalizeFilePath(cssPath)

			ensureCssDependencies(normalizedPath)

			const tsxPath = silo.getState(siblingTsxPathSelectors, normalizedPath)

			if (tsxPath === null) return

			const renderStoryAnalysis = silo.getState(renderStorySelectors, tsxPath)

			return renderStoryAnalysis.kind === `ready`
				? renderStoryAnalysis.renderStory
				: undefined
		},
		getWatchedTsxPaths(): string[] {
			return [...silo.getState(watchedTsxPathsAtom)]
		},
		indexWorkspaceFolders,
		openDocument(input: LspDocumentInput): void {
			const normalizedPath = normalizeFilePath(input.path)

			runUpsertOpenDocument({
				...input,
				path: normalizedPath,
			})
			ensureCssDependencies(normalizedPath)
		},
		refreshDiskFile,
		silo,
		subscribeToCssDiagnostics(
			cssPath: string,
			callback: (diagnostics: Diagnostic[]) => void,
		): () => void {
			const normalizedPath = normalizeFilePath(cssPath)

			ensureCssDependencies(normalizedPath)

			const diagnosticsToken = silo.findState(
				lspDiagnosticSelectors,
				normalizedPath,
			)
			const unsubscribe = silo.subscribe(diagnosticsToken, () => {
				callback([...silo.getState(diagnosticsToken)])
			})

			callback([...silo.getState(diagnosticsToken)])

			return unsubscribe
		},
	}
}
