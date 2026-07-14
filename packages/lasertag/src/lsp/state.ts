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
	analyzeCssReachability,
	ambiguousRenderSourceMessage,
	analyzeRenderStory,
	ASTRO_SUFFIX,
	CSS_MODULE_SUFFIX,
	findCssClassRenderRoots,
	isAstroPath,
	isTsxPath,
	siblingRenderSourceCandidates,
	scopeRenderStoryToCssClassRoots,
	sourcePathToSiblingCssModulePath,
	TSX_SUFFIX,
	type CssReachabilityDiagnostic,
	type CssReachabilityAnalysis,
	type CssSelectorAnalysis,
	type CssSelectorReachabilityAnalysis,
	type Reachability,
	type RenderStory,
	type SelectorPath,
	type StoryChild,
} from "../refractor/index.ts"

export {
	isAstroPath,
	isRenderSourcePath,
	isTsxPath,
} from "../refractor/index.ts"

const WATCHED_CSS_PATTERN = `**/*.module.css`
const WATCHED_TSX_PATTERN = `**/*.tsx`
const WATCHED_ASTRO_PATTERN = `**/*.astro`
const DEFAULT_IGNORE_PATTERNS = [
	`**/node_modules/**`,
	`**/dist/**`,
	`**/build/**`,
	`**/coverage/**`,
	`**/tests/refractor/corpus/providers/**`,
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

export type RenderStoryAnalysis =
	| {
			kind: `ready`
			renderStory: RenderStory
	  }
	| {
			kind: `missing` | `error`
			message?: string
	  }

export type CssSelectorAnalysisState =
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
	astroPaths: string[]
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

export function findSiblingTsxPathFromConvention(
	cssPath: string,
): string | undefined {
	if (!isCssModulePath(cssPath)) return

	return `${cssPath.slice(0, -CSS_MODULE_SUFFIX.length)}${TSX_SUFFIX}`
}

export function findSiblingAstroPathFromConvention(
	cssPath: string,
): string | undefined {
	if (!isCssModulePath(cssPath)) return

	return `${cssPath.slice(0, -CSS_MODULE_SUFFIX.length)}${ASTRO_SUFFIX}`
}

export function findSiblingCssModulePathFromConvention(
	sourcePath: string,
): string | undefined {
	return sourcePathToSiblingCssModulePath(sourcePath)
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
	key: `workspaceFolderPaths`,
})

const watchedCssModulePathsAtom = atom<string[]>({
	default: [],
	key: `watchedCssModulePaths`,
})

const watchedTsxPathsAtom = atom<string[]>({
	default: [],
	key: `watchedTsxPaths`,
})

const watchedAstroPathsAtom = atom<string[]>({
	default: [],
	key: `watchedAstroPaths`,
})

const openDocumentPathsAtom = atom<string[]>({
	default: [],
	key: `openDocumentPaths`,
})

const openDocumentAtoms = atomFamily<OpenDocument | null, string>({
	default: null,
	key: `openDocument`,
})

const diskFileSnapshotAtoms = atomFamily<FileSnapshot, string>({
	default: missingSnapshot,
	key: `diskFileSnapshot`,
})

const knownCssModulePathsSelector = selector<string[]>({
	get: ({ get }) => {
		const watchedCssPaths = get(watchedCssModulePathsAtom)
		const openCssPaths = get(openDocumentPathsAtom).filter(isCssModulePath)

		return uniqueSorted([...watchedCssPaths, ...openCssPaths])
	},
	key: `knownCssModulePaths`,
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
	key: `fileSnapshot`,
})

const fileTextSelectors = selectorFamily<string | null, string>({
	get:
		(filePath) =>
		({ get }) => {
			const snapshot = get(fileSnapshotSelectors, filePath)

			return snapshot.exists ? snapshot.text : null
		},
	key: `fileText`,
})

const documentUriSelectors = selectorFamily<string, string>({
	get:
		(filePath) =>
		({ get }) => {
			const openDocument = get(openDocumentAtoms, filePath)

			return openDocument?.uri ?? pathToFileURL(filePath).href
		},
	key: `documentUri`,
})

export type SiblingRenderSourceAnalysis =
	| { kind: `missing`; candidates: RenderSourceCandidateTrace[] }
	| {
			kind: `ready`
			candidates: RenderSourceCandidateTrace[]
			sourcePath: string
	  }
	| {
			kind: `ambiguous`
			candidates: RenderSourceCandidateTrace[]
			message: string
	  }

export type RenderSourceCandidateTrace = {
	exists: boolean
	path: string
}

export type SelectorReachabilityTrace = {
	diagnosticCodes: Array<CssReachabilityDiagnostic[`code`]>
	paths: Array<{
		path: SelectorPath
		reachability: Reachability
	}>
	reachability: Reachability | `not-applicable`
	reason?: string
	resultKind: CssSelectorAnalysis[`result`][`kind`]
	selector: string
}

export type LasertagLspAnalysisTrace = {
	cssAnalysis: CssSelectorAnalysisState
	cssPath: string
	publishedDiagnostics: Diagnostic[]
	reachabilityDiagnostics: CssReachabilityDiagnostic[]
	renderStoryAnalysis: RenderStoryAnalysis
	selectorReachability: SelectorReachabilityTrace[]
	sourceResolution: SiblingRenderSourceAnalysis
	summary: {
		cssClassRootCount: number
		diagnosticCount: number
		elementCount: number
		opaqueCount: number
		renderStoryKind: RenderStoryAnalysis[`kind`]
		rootCount: number
		rootDiscoveryKind:
			| `css-class-attachment`
			| `missing-css-class-attachment`
			| `unavailable`
		selectorCount: number
		sourceKind: SiblingRenderSourceAnalysis[`kind`]
		sourcePath?: string
		unknownSelectorCount: number
		unreachableSelectorCount: number
	}
}

function countRenderStoryNodes(children: StoryChild[]): {
	elementCount: number
	opaqueCount: number
} {
	let elementCount = 0
	let opaqueCount = 0

	for (const child of children) {
		if (child.kind === `opaque`) {
			opaqueCount += 1
			continue
		}

		elementCount += 1
		const descendants = countRenderStoryNodes(child.children)
		elementCount += descendants.elementCount
		opaqueCount += descendants.opaqueCount
	}

	return { elementCount, opaqueCount }
}

function selectorReachabilityTrace(
	selectorAnalyses: readonly CssSelectorReachabilityAnalysis[],
	diagnostics: readonly CssReachabilityDiagnostic[],
): SelectorReachabilityTrace[] {
	return selectorAnalyses.map((analysis): SelectorReachabilityTrace => {
		const diagnosticCodes = diagnostics
			.filter(
				(diagnostic) =>
					diagnostic.selector === analysis.selector &&
					diagnostic.range?.start === analysis.range.start &&
					diagnostic.range?.end === analysis.range.end,
			)
			.map((diagnostic) => diagnostic.code)

		const { range: _range, ...trace } = analysis

		return {
			...trace,
			diagnosticCodes,
		}
	})
}

function createAnalysisErrorDiagnostic(
	code: string,
	message: string,
): Diagnostic {
	return {
		code,
		message,
		range: {
			end: { character: 0, line: 0 },
			start: { character: 0, line: 0 },
		},
		severity: DiagnosticSeverity.Error,
		source: `lasertag`,
	}
}

const siblingRenderSourceSelectors = selectorFamily<
	SiblingRenderSourceAnalysis,
	string
>({
	get:
		(cssPath) =>
		({ get }) => {
			const candidates = siblingRenderSourceCandidates(cssPath).map(
				(candidate): RenderSourceCandidateTrace => ({
					exists: get(fileSnapshotSelectors, candidate.path).exists,
					path: candidate.path,
				}),
			)
			const sources = candidates.filter((candidate) => candidate.exists)

			if (sources.length === 0) return { candidates, kind: `missing` }
			if (sources.length === 1 && sources[0]) {
				return { candidates, kind: `ready`, sourcePath: sources[0].path }
			}

			return {
				candidates,
				kind: `ambiguous`,
				message: ambiguousRenderSourceMessage(
					cssPath,
					sources.map((source) => ({
						kind: source.path.endsWith(ASTRO_SUFFIX) ? `astro` : `tsx`,
						path: source.path,
					})),
				),
			}
		},
	key: `siblingRenderSource`,
})

const renderStorySelectors = selectorFamily<RenderStoryAnalysis, string>({
	get:
		(sourcePath) =>
		({ get }) => {
			const sourceText = get(fileTextSelectors, sourcePath)

			if (sourceText === null) return { kind: `missing` }

			try {
				return {
					kind: `ready`,
					renderStory: scopeRenderStoryToCssClassRoots(
						analyzeRenderStory({
							sourcePath,
							sourceText,
						}),
						{ missingAttachment: `opaque` },
					),
				}
			} catch (error) {
				return {
					kind: `error`,
					message: messageFromError(error),
				}
			}
		},
	key: `renderStory`,
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
	key: `cssSelectorAnalysis`,
})

const cssReachabilityAnalysisSelectors = selectorFamily<
	CssReachabilityAnalysis | null,
	string
>({
	get:
		(cssPath) =>
		({ get }) => {
			if (!isCssModulePath(cssPath)) return null

			const selectorAnalysis = get(cssSelectorAnalysisSelectors, cssPath)

			if (selectorAnalysis.kind !== `ready`) return null

			const source = get(siblingRenderSourceSelectors, cssPath)

			if (source.kind !== `ready`) return null

			const renderStoryAnalysis = get(renderStorySelectors, source.sourcePath)

			if (renderStoryAnalysis.kind !== `ready`) return null

			return analyzeCssReachability({
				cssSource: get(fileTextSelectors, cssPath) ?? ``,
				renderStory: renderStoryAnalysis.renderStory,
				selectorAnalyses: selectorAnalysis.selectorAnalyses,
			})
		},
	key: `cssReachabilityAnalysis`,
})

const refractorDiagnosticSelectors = selectorFamily<
	CssReachabilityDiagnostic[],
	string
>({
	get:
		(cssPath) =>
		({ get }) => {
			return get(cssReachabilityAnalysisSelectors, cssPath)?.diagnostics ?? []
		},
	key: `refractorDiagnostic`,
})

const lspDiagnosticSelectors = selectorFamily<Diagnostic[], string>({
	get:
		(cssPath) =>
		({ get }) => {
			const cssSource = get(fileTextSelectors, cssPath) ?? ``
			const source = get(siblingRenderSourceSelectors, cssPath)

			if (source.kind === `ambiguous`) {
				return [
					createAnalysisErrorDiagnostic(
						`ambiguous-render-source`,
						source.message,
					),
				]
			}

			const cssAnalysis = get(cssSelectorAnalysisSelectors, cssPath)

			if (cssAnalysis.kind === `error`) {
				return [
					createAnalysisErrorDiagnostic(
						`css-analysis-error`,
						`Could not analyze CSS selectors: ${cssAnalysis.message ?? `unknown error`}`,
					),
				]
			}

			if (source.kind === `ready`) {
				const renderStoryAnalysis = get(renderStorySelectors, source.sourcePath)

				if (renderStoryAnalysis.kind === `error`) {
					return [
						createAnalysisErrorDiagnostic(
							`render-story-analysis-error`,
							`Could not analyze render source "${source.sourcePath}": ${renderStoryAnalysis.message ?? `unknown error`}`,
						),
					]
				}
			}

			const diagnostics = get(refractorDiagnosticSelectors, cssPath)

			return diagnostics.map((diagnostic) =>
				mapRefractorDiagnosticToLsp(cssSource, diagnostic),
			)
		},
	key: `lspDiagnostic`,
})

const affectedCssPathsByRenderSourceSelectors = selectorFamily<
	string[],
	string
>({
	get:
		(sourcePath) =>
		({ get }) => {
			const candidate = findSiblingCssModulePathFromConvention(sourcePath)

			if (!candidate) return []

			return get(knownCssModulePathsSelector).filter(
				(cssPath) => cssPath === candidate,
			)
		},
	key: `affectedCssPathsByRenderSource`,
})

const indexWorkspaceFilesTransaction = transaction<
	(input: WorkspaceIndexInput) => void
>({
	do: (
		{ set },
		{
			astroPaths,
			cssPaths,
			tsxPaths,
			workspaceFolderPaths,
		}: WorkspaceIndexInput,
	) => {
		set(workspaceFolderPathsAtom, uniqueSorted(workspaceFolderPaths))
		set(watchedCssModulePathsAtom, uniqueSorted(cssPaths))
		set(watchedTsxPathsAtom, uniqueSorted(tsxPaths))
		set(watchedAstroPathsAtom, uniqueSorted(astroPaths))
	},
	key: `indexWorkspaceFiles`,
})

const upsertOpenDocumentTransaction = transaction<
	(input: LspDocumentInput) => void
>({
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

		if (isAstroPath(filePath)) {
			set(watchedAstroPathsAtom, addPath(get(watchedAstroPathsAtom), filePath))
		}
	},
	key: `upsertOpenDocument`,
})

const closeDocumentTransaction = transaction<(filePath: string) => void>({
	do: ({ get, set }, filePath: string) => {
		set(openDocumentAtoms, filePath, null)
		set(openDocumentPathsAtom, removePath(get(openDocumentPathsAtom), filePath))
	},
	key: `closeDocument`,
})

const refreshDiskFileTransaction = transaction<
	(input: DiskSnapshotInput) => void
>({
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

		if (isAstroPath(filePath)) {
			const currentPaths = get(watchedAstroPathsAtom)
			set(
				watchedAstroPathsAtom,
				snapshot.exists
					? addPath(currentPaths, filePath)
					: removePath(currentPaths, filePath),
			)
		}
	},
	key: `refreshDiskFile`,
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
		watchedAstroPathsAtom,
		openDocumentPathsAtom,
		openDocumentAtoms,
		diskFileSnapshotAtoms,
		knownCssModulePathsSelector,
		fileSnapshotSelectors,
		fileTextSelectors,
		documentUriSelectors,
		siblingRenderSourceSelectors,
		renderStorySelectors,
		cssSelectorAnalysisSelectors,
		cssReachabilityAnalysisSelectors,
		refractorDiagnosticSelectors,
		lspDiagnosticSelectors,
		affectedCssPathsByRenderSourceSelectors,
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

		if (
			!isOpen(normalizedPath) &&
			silo.getState(diskFileSnapshotAtoms, normalizedPath).revision === 0
		) {
			refreshDiskFile(normalizedPath)
		}
	}

	function ensureCssDependencies(cssPath: string): void {
		const normalizedCssPath = normalizeFilePath(cssPath)

		if (!isCssModulePath(normalizedCssPath)) return

		ensureFileSnapshot(normalizedCssPath)

		for (const candidate of siblingRenderSourceCandidates(normalizedCssPath)) {
			ensureFileSnapshot(candidate.path)
		}
	}

	function discoverWorkspaceFiles(workspaceFolderPaths: string[]) {
		const astroPaths: string[] = []
		const cssPaths: string[] = []
		const tsxPaths: string[] = []

		for (const workspaceFolderPath of workspaceFolderPaths) {
			const normalizedWorkspacePath = normalizeFilePath(workspaceFolderPath)

			astroPaths.push(
				...glob(WATCHED_ASTRO_PATTERN, {
					absolute: true,
					cwd: normalizedWorkspacePath,
					ignore: DEFAULT_IGNORE_PATTERNS,
					onlyFiles: true,
				}).map(normalizeFilePath),
			)
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
			astroPaths: uniqueSorted(astroPaths),
			cssPaths: uniqueSorted(cssPaths),
			tsxPaths: uniqueSorted(tsxPaths),
		}
	}

	function indexWorkspaceFolders(workspaceFolderPaths: string[]): void {
		const normalizedWorkspaceFolderPaths = normalizePaths(workspaceFolderPaths)
		const { astroPaths, cssPaths, tsxPaths } = discoverWorkspaceFiles(
			normalizedWorkspaceFolderPaths,
		)

		runIndexWorkspaceFiles({
			astroPaths,
			cssPaths,
			tsxPaths,
			workspaceFolderPaths: normalizedWorkspaceFolderPaths,
		})
	}

	function getAnalysisTrace(cssPath: string): LasertagLspAnalysisTrace {
		const normalizedPath = normalizeFilePath(cssPath)

		ensureCssDependencies(normalizedPath)

		const sourceResolution = silo.getState(
			siblingRenderSourceSelectors,
			normalizedPath,
		)
		const cssAnalysis = silo.getState(
			cssSelectorAnalysisSelectors,
			normalizedPath,
		)
		const renderStoryAnalysis =
			sourceResolution.kind === `ready`
				? silo.getState(renderStorySelectors, sourceResolution.sourcePath)
				: ({ kind: `missing` } as const)
		const reachabilityDiagnostics = silo.getState(
			refractorDiagnosticSelectors,
			normalizedPath,
		)
		const reachabilityAnalysis = silo.getState(
			cssReachabilityAnalysisSelectors,
			normalizedPath,
		)
		const publishedDiagnostics = silo.getState(
			lspDiagnosticSelectors,
			normalizedPath,
		)
		const selectorReachability = reachabilityAnalysis
			? selectorReachabilityTrace(
					reachabilityAnalysis.selectorReachability,
					reachabilityDiagnostics,
				)
			: []
		const storyCounts =
			renderStoryAnalysis.kind === `ready`
				? countRenderStoryNodes(renderStoryAnalysis.renderStory.roots)
				: { elementCount: 0, opaqueCount: 0 }
		const cssClassRootCount =
			renderStoryAnalysis.kind === `ready`
				? findCssClassRenderRoots(renderStoryAnalysis.renderStory.roots).length
				: 0

		return {
			cssAnalysis,
			cssPath: normalizedPath,
			publishedDiagnostics: [...publishedDiagnostics],
			reachabilityDiagnostics: [...reachabilityDiagnostics],
			renderStoryAnalysis,
			selectorReachability,
			sourceResolution,
			summary: {
				cssClassRootCount,
				diagnosticCount: publishedDiagnostics.length,
				elementCount: storyCounts.elementCount,
				opaqueCount: storyCounts.opaqueCount,
				renderStoryKind: renderStoryAnalysis.kind,
				rootCount:
					renderStoryAnalysis.kind === `ready`
						? renderStoryAnalysis.renderStory.roots.length
						: 0,
				rootDiscoveryKind:
					renderStoryAnalysis.kind !== `ready`
						? `unavailable`
						: cssClassRootCount > 0
							? `css-class-attachment`
							: `missing-css-class-attachment`,
				selectorCount:
					cssAnalysis.kind === `ready`
						? cssAnalysis.selectorAnalyses.length
						: 0,
				sourceKind: sourceResolution.kind,
				...(sourceResolution.kind === `ready`
					? { sourcePath: sourceResolution.sourcePath }
					: {}),
				unknownSelectorCount: selectorReachability.filter(
					({ reachability }) => reachability === `unknown`,
				).length,
				unreachableSelectorCount: selectorReachability.filter(
					({ reachability }) => reachability === `unreachable`,
				).length,
			},
		}
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
		getAffectedCssPathsForRenderSource(sourcePath: string): string[] {
			return [
				...silo.getState(
					affectedCssPathsByRenderSourceSelectors,
					normalizeFilePath(sourcePath),
				),
			]
		},
		getAffectedCssPathsForTsx(tsxPath: string): string[] {
			return [
				...silo.getState(
					affectedCssPathsByRenderSourceSelectors,
					normalizeFilePath(tsxPath),
				),
			]
		},
		getAnalysisTrace,
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

			const source = silo.getState(siblingRenderSourceSelectors, normalizedPath)

			if (source.kind !== `ready`) return

			const renderStoryAnalysis = silo.getState(
				renderStorySelectors,
				source.sourcePath,
			)

			return renderStoryAnalysis.kind === `ready`
				? renderStoryAnalysis.renderStory
				: undefined
		},
		getWatchedTsxPaths(): string[] {
			return [...silo.getState(watchedTsxPathsAtom)]
		},
		getWatchedAstroPaths(): string[] {
			return [...silo.getState(watchedAstroPathsAtom)]
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
