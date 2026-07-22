import { readFileSync } from "node:fs"
import path from "node:path"

import type { Node, SourceFile } from "typescript/unstable/ast"
import type { FileSystem } from "typescript/unstable/fs"
import { API, type Project, SymbolFlags } from "typescript/unstable/sync"

import {
	resolveTypescriptSdkPath,
	type TypescriptRuntimeOptions,
} from "./typescript-runtime.ts"

/** A synchronous, single-owner TypeScript parser session for batched analysis. */
export type TypescriptAstAnalysis = {
	resolveAliasedDeclarations(node: Node): Node[]
}

export type TypescriptAstSession = {
	[Symbol.dispose](): void
	close(): void
	withSourceFile<TResult>(
		sourceText: string,
		filePath: string,
		use: (sourceFile: SourceFile, analysis: TypescriptAstAnalysis) => TResult,
	): TResult
}

function createTypescriptAstAnalysis(
	project: Project,
	dependencySources: Map<string, string>,
	rootFilePath: string,
): TypescriptAstAnalysis {
	return {
		resolveAliasedDeclarations(node) {
			const symbol = project.checker.getSymbolAtLocation(node)

			if (!symbol) return []

			let resolvedSymbol = symbol
			const seenSymbols = new Set<number>()

			while (!seenSymbols.has(resolvedSymbol.id)) {
				seenSymbols.add(resolvedSymbol.id)

				for (const declaration of resolvedSymbol.declarations) {
					const resolvedDeclaration = declaration.resolve(project)

					if (!resolvedDeclaration) continue

					const sourceFile = resolvedDeclaration.getSourceFile()
					const sourceFilePath = normalizeFilePath(sourceFile.fileName)

					if (sourceFilePath !== rootFilePath) {
						dependencySources.set(sourceFilePath, sourceFile.text)
					}
				}

				if ((resolvedSymbol.flags & SymbolFlags.Alias) === 0) break

				const aliasedSymbol =
					project.checker.getImmediateAliasedSymbol(resolvedSymbol)

				if (!aliasedSymbol) break

				resolvedSymbol = aliasedSymbol
			}

			if (project.checker.isUnknownSymbol(resolvedSymbol)) return []

			return resolvedSymbol.declarations.flatMap((declaration) => {
				const resolvedDeclaration = declaration.resolve(project)

				return resolvedDeclaration ? [resolvedDeclaration] : []
			})
		},
	}
}

function dependencySourceChanged(
	dependencySources: ReadonlyMap<string, string>,
	virtualSources: ReadonlyMap<string, string>,
): boolean {
	for (const [filePath, previousSource] of dependencySources) {
		if (virtualSources.has(filePath)) continue

		try {
			if (readFileSync(filePath, `utf8`) !== previousSource) return true
		} catch {
			return true
		}
	}

	return false
}

function normalizeFilePath(filePath: string): string {
	return path.resolve(filePath)
}

function createSessionFileSystem(sources: Map<string, string>): FileSystem {
	return {
		fileExists(candidate) {
			return sources.has(normalizeFilePath(candidate)) ? true : undefined
		},
		readFile(candidate) {
			const normalizedCandidate = normalizeFilePath(candidate)

			return sources.has(normalizedCandidate)
				? sources.get(normalizedCandidate)
				: undefined
		},
		realpath(candidate) {
			const normalizedCandidate = normalizeFilePath(candidate)

			return sources.has(normalizedCandidate) ? normalizedCandidate : undefined
		},
	}
}

export function createTypescriptAstSession(
	options: TypescriptRuntimeOptions = {},
): TypescriptAstSession {
	const sources = new Map<string, string>()
	const dependencySources = new Map<string, string>()
	const typescriptSdkPath = resolveTypescriptSdkPath(options)
	let api: API | undefined
	let closed = false
	let openFilePath: string | undefined

	function getApi(filePath: string): API {
		api ??= new API({
			cwd: path.dirname(filePath),
			fs: createSessionFileSystem(sources),
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
			openFilePath = undefined
			sources.clear()
			api?.close()
			api = undefined
			dependencySources.clear()
		},
		withSourceFile(sourceText, filePath, use) {
			if (closed) {
				throw new Error(`Cannot parse TSX with a closed TypeScript session.`)
			}

			const normalizedFilePath = normalizeFilePath(filePath)
			const activeApi = getApi(normalizedFilePath)
			const previousFilePath = openFilePath

			// TypeScript keeps open files alive across snapshots. Reopening the same
			// path in one update leaves its unstable sync API on the previous source,
			// so release it before replacing the virtual file contents.
			if (previousFilePath === normalizedFilePath) {
				const closingSnapshot = activeApi.updateSnapshot({
					closeFiles: [previousFilePath],
				})

				closingSnapshot.dispose()
				openFilePath = undefined
			}

			sources.set(normalizedFilePath, sourceText)
			const dependencyChanged = dependencySourceChanged(
				dependencySources,
				sources,
			)

			if (dependencyChanged) dependencySources.clear()

			const snapshot = activeApi.updateSnapshot({
				...(previousFilePath && previousFilePath !== normalizedFilePath
					? { closeFiles: [previousFilePath] }
					: {}),
				// Imported component roots are ownership evidence. Rebuild the program
				// when one of their declarations changes so a long-lived editor session
				// never retains a verified root after its implementation changes.
				fileChanges: dependencyChanged
					? { invalidateAll: true }
					: previousFilePath === normalizedFilePath
						? { changed: [normalizedFilePath] }
						: {
								created: [normalizedFilePath],
								...(previousFilePath ? { deleted: [previousFilePath] } : {}),
							},
				openFiles: [normalizedFilePath],
			})

			try {
				// The unstable client retains decoded source files even after a path is
				// closed. Each task supplies fresh text, so never carry that AST cache
				// across worker queue entries.
				activeApi.clearSourceFileCache()

				if (previousFilePath && previousFilePath !== normalizedFilePath) {
					sources.delete(previousFilePath)
				}

				openFilePath = normalizedFilePath

				const project = snapshot.getDefaultProjectForFile(normalizedFilePath)
				const sourceFile = project?.program.getSourceFile(normalizedFilePath)

				if (!project || !sourceFile) {
					throw new Error(
						`Unable to parse TSX source file ${normalizedFilePath}.`,
					)
				}

				// The comparison above consumed the previous analysis's dependency
				// snapshot. Record only dependencies discovered by this analysis so
				// serial worker queues do not accumulate unrelated projects.
				dependencySources.clear()

				return use(
					sourceFile,
					createTypescriptAstAnalysis(
						project,
						dependencySources,
						normalizedFilePath,
					),
				)
			} finally {
				snapshot.dispose()
			}
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
