import { readFileSync } from "node:fs"
import path from "node:path"

import type { Node, SourceFile } from "typescript/ast"
import {
	createFileSystemLayer,
	serverFS,
	type FileSystemCallbacks,
} from "typescript/fs"
import {
	API,
	type CompilerOptions,
	type Project,
	type Snapshot,
	SymbolFlags,
} from "typescript/sync"

import {
	resolveTypescriptSdkPath,
	type TypescriptRuntimeOptions,
} from "./typescript-runtime.ts"

/** A synchronous, single-owner TypeScript parser session for batched analysis. */
export type TypescriptAstAnalysis = {
	/** Explicit project settings only; inferred projects do not establish a JSX runtime. */
	compilerOptions?: CompilerOptions
	/** Resolve a value's local binding without following import aliases. */
	resolveValueDeclarations?(name: string, location: Node): Node[]
	resolveAliasedDeclarations(node: Node): Node[]
	isDefaultLibrary?(sourceFile: SourceFile): boolean
	/** Includes parse diagnostics reported by a content mapper for this source. */
	hasSyntacticErrors?(): boolean
}

export type TypescriptAstSession = {
	[Symbol.dispose](): void
	close(): void
	withSourceFile<TResult>(
		sourceText: string,
		filePath: string,
		use: (sourceFile: SourceFile, analysis: TypescriptAstAnalysis) => TResult,
		sourceOptions?: TypescriptAstSourceOptions,
	): TResult
}

export type TypescriptAstSourceOptions = {
	/** Complete current set of unsaved documents, including imported files. */
	openFiles?: ReadonlyMap<string, string>
	/** Host file notifications since the last request. */
	invalidate?: boolean
}

function createTypescriptAstAnalysis(
	project: Project,
	dependencySources: Map<string, string>,
	rootFilePath: string,
	onUnresolvedSymbol: () => void,
): TypescriptAstAnalysis {
	function unresolvedDeclarations(): Node[] {
		onUnresolvedSymbol()
		return []
	}
	let compilerOptions: CompilerOptions | undefined
	if (project.configFileName) {
		try {
			const configSource = readFileSync(project.configFileName, `utf8`)
			dependencySources.set(
				normalizeFilePath(project.configFileName),
				configSource,
			)
			compilerOptions = project.parsedCommandLine.options
		} catch {
			// Unreadable project settings cannot establish a JSX runtime.
		}
	}
	// Inferred project defaults are parser settings, not application evidence.
	return {
		...(compilerOptions ? { compilerOptions } : {}),
		hasSyntacticErrors() {
			return project.program.getSyntacticDiagnostics(rootFilePath).length > 0
		},
		resolveValueDeclarations(name, location) {
			const symbol = project.checker.resolveName(
				name,
				SymbolFlags.Value,
				location,
				true,
			)
			return (
				symbol?.declarations.flatMap((declaration) => {
					const resolvedDeclaration = declaration.resolve(project)
					return resolvedDeclaration ? [resolvedDeclaration] : []
				}) ?? []
			)
		},
		isDefaultLibrary(sourceFile) {
			return (
				project.program.getSourceFileMetadata(sourceFile.fileName)
					?.isDefaultLibrary === true
			)
		},
		resolveAliasedDeclarations(node) {
			const symbol = project.checker.getSymbolAtLocation(node)

			if (!symbol) return unresolvedDeclarations()

			let resolvedSymbol = symbol
			const seenSymbols = new Set<number>()

			while (!seenSymbols.has(resolvedSymbol.id)) {
				seenSymbols.add(resolvedSymbol.id)

				for (const declaration of resolvedSymbol.declarations) {
					const resolvedDeclaration = declaration.resolve(project)

					if (!resolvedDeclaration) continue

					const sourceFile = resolvedDeclaration.getSourceFile()
					const sourceFilePath = normalizeFilePath(
						sourceFile.canonicalSourceFileName ?? sourceFile.fileName,
					)

					if (sourceFilePath !== rootFilePath) {
						dependencySources.set(
							sourceFilePath,
							sourceFile.originalText ?? sourceFile.text,
						)
					}
				}

				if ((resolvedSymbol.flags & SymbolFlags.Alias) === 0) break

				const aliasedSymbol =
					project.checker.getImmediateAliasedSymbol(resolvedSymbol)

				if (!aliasedSymbol) return unresolvedDeclarations()

				resolvedSymbol = aliasedSymbol
			}

			if (
				(resolvedSymbol.flags & SymbolFlags.Alias) !== 0 ||
				project.checker.isUnknownSymbol(resolvedSymbol)
			)
				return unresolvedDeclarations()

			return resolvedSymbol.declarations.flatMap((declaration) => {
				const resolvedDeclaration = declaration.resolve(project)

				return resolvedDeclaration ? [resolvedDeclaration] : []
			})
		},
	}
}

function dependencySourceChanges(
	dependencySources: ReadonlyMap<string, string>,
	virtualSources: ReadonlyMap<string, string>,
): string[] {
	const changed: string[] = []
	for (const [filePath, previousSource] of dependencySources) {
		if (virtualSources.has(filePath)) continue

		try {
			if (readFileSync(filePath, `utf8`) !== previousSource)
				changed.push(filePath)
		} catch {
			changed.push(filePath)
		}
	}

	return changed
}

function normalizeFilePath(filePath: string): string {
	return path.resolve(filePath)
}

function createSessionFileSystem(
	configurationSources: Map<string, string>,
): FileSystemCallbacks {
	return {
		directoryExists: serverFS.useOS,
		fileExists: serverFS.useOS,
		getAccessibleEntries: serverFS.useOS,
		realpath: serverFS.useOS,
		stat: serverFS.useOS,
		writeFile: serverFS.error,
		removeFile: serverFS.error,
		readFile(candidate) {
			const normalizedCandidate = normalizeFilePath(candidate)
			// An extended config can have any JSON filename or come from a package.
			// Observe TypeScript's reads rather than duplicating its config resolver.
			if (path.extname(normalizedCandidate) === `.json`) {
				try {
					const text = readFileSync(normalizedCandidate, `utf8`)
					configurationSources.set(normalizedCandidate, text)
					return text
				} catch {
					return undefined
				}
			}
			return serverFS.useOS
		},
	}
}

export function createTypescriptAstSession(
	options: TypescriptRuntimeOptions = {},
): TypescriptAstSession {
	const sources = new Map<string, string>()
	// A filesystem layer retains earlier overlays. Explicitly restore closed
	// overlays from disk, and refresh these copies until they are overlaid again.
	const restoredSources = new Set<string>()
	const knownRoots = new Set<string>()
	const dependencySources = new Map<string, string>()
	const configurationSources = new Map<string, string>()
	const typescriptSdkPath = resolveTypescriptSdkPath(options)
	let api: API | undefined
	let snapshot: Snapshot | undefined
	let closed = false
	let openFilePath: string | undefined
	let unresolvedSymbol = false

	function getApi(filePath: string): API {
		api ??= new API({
			cwd: path.dirname(filePath),
			fs: createSessionFileSystem(configurationSources),
			runExternalCode: options.runExternalCode ?? false,
			...(typescriptSdkPath ? { tsserverPath: typescriptSdkPath } : {}),
		})

		return api
	}

	const session: TypescriptAstSession = {
		[Symbol.dispose]() {
			session.close()
		},
		close() {
			if (closed) return

			closed = true
			snapshot?.dispose()
			snapshot = undefined
			openFilePath = undefined
			sources.clear()
			restoredSources.clear()
			knownRoots.clear()
			api?.close()
			api = undefined
			dependencySources.clear()
			configurationSources.clear()
		},
		withSourceFile(sourceText, filePath, use, sourceOptions = {}) {
			if (closed) {
				throw new Error(`Cannot parse TSX with a closed TypeScript session.`)
			}

			const normalizedFilePath = normalizeFilePath(filePath)
			const activeApi = getApi(normalizedFilePath)
			const previousFilePath = openFilePath
			const currentSources = new Map(
				[...(sourceOptions.openFiles ?? [])].map(([name, text]) => [
					normalizeFilePath(name),
					text,
				]),
			)
			currentSources.set(normalizedFilePath, sourceText)
			const configurationOverlayChanged = [
				...new Set([...sources.keys(), ...currentSources.keys()]),
			].some(
				(name) =>
					/\.jsonc?$/.test(name) &&
					sources.get(name) !== currentSources.get(name),
			)
			const dependencyChanges = dependencySourceChanges(
				dependencySources,
				currentSources,
			)
			const configurationChanges = dependencySourceChanges(
				configurationSources,
				currentSources,
			)
			// A failed module lookup can become valid when a file is created or
			// restored, without changing any dependency we could read last time.
			// This session has no directory watcher, so retry after unresolved queries.
			const invalidate =
				configurationChanges.length > 0 ||
				configurationOverlayChanged ||
				unresolvedSymbol ||
				sourceOptions.invalidate === true
			unresolvedSymbol = false
			const previousSnapshot = snapshot
			const reuseSnapshot =
				previousSnapshot &&
				configurationChanges.length === 0 &&
				!configurationOverlayChanged &&
				sourceOptions.invalidate !== true
			if (!reuseSnapshot) {
				restoredSources.clear()
				knownRoots.clear()
			} else
				for (const name of sources.keys()) {
					if (!currentSources.has(name)) restoredSources.add(name)
				}
			for (const name of currentSources.keys()) restoredSources.delete(name)
			const restored: Array<[string, string]> = []
			const removedPaths: string[] = []
			for (const name of restoredSources) {
				try {
					restored.push([name, readFileSync(name, `utf8`)])
				} catch {
					removedPaths.push(name)
					knownRoots.delete(name)
				}
			}
			const fileSystem = createFileSystemLayer(
				[...currentSources, ...restored],
				{ removedPaths },
			)

			// Keep configured projects alive when switching roots. Closing a native
			// open file and replacing its virtual contents are separate operations.
			// Keep observations for every visited root, including across broad
			// invalidations. Only consume changed versions; callbacks record new ones.
			for (const name of dependencyChanges) dependencySources.delete(name)
			for (const name of configurationChanges) configurationSources.delete(name)
			snapshot = reuseSnapshot
				? previousSnapshot.update({
						fileSystem,
						ensurePrograms: true,
						...(previousFilePath !== normalizedFilePath
							? {
									openFiles: [normalizedFilePath],
									closeFiles: previousFilePath ? [previousFilePath] : [],
								}
							: {}),
						fileNotifications: invalidate
							? { invalidateAll: true }
							: {
									...(dependencyChanges.length
										? { changed: dependencyChanges }
										: {}),
									// Opening a newly authored root must reevaluate tsconfig globs.
									...(!knownRoots.has(normalizedFilePath)
										? { created: [normalizedFilePath] }
										: {}),
								},
					})
				: activeApi.createSnapshot({
						fileSystem,
						openFiles: [normalizedFilePath],
						...(invalidate
							? { fileNotifications: { invalidateAll: true } }
							: {}),
					})
			previousSnapshot?.dispose()
			openFilePath = normalizedFilePath
			knownRoots.add(normalizedFilePath)
			sources.clear()
			for (const [name, text] of currentSources) sources.set(name, text)

			const project = snapshot.getDefaultProjectForFile(normalizedFilePath)
			const sourceFile = project?.program.getSourceFile(normalizedFilePath)
			if (!project || !sourceFile) {
				throw new Error(
					`Unable to parse TSX source file ${normalizedFilePath}.`,
				)
			}
			return use(
				sourceFile,
				createTypescriptAstAnalysis(
					project,
					dependencySources,
					normalizedFilePath,
					() => {
						unresolvedSymbol = true
					},
				),
			)
		},
	}

	return session
}

export function createTsxSourceFile(
	sourceText: string,
	filePath = `component.tsx`,
	options: TypescriptRuntimeOptions = {},
): SourceFile {
	const session = createTypescriptAstSession(options)

	try {
		return session.withSourceFile(
			sourceText,
			filePath,
			(sourceFile) => sourceFile,
		)
	} finally {
		session.close()
	}
}
