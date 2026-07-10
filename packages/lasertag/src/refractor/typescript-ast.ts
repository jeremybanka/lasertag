import path from "node:path"

import type { SourceFile } from "typescript/unstable/ast"
import type { FileSystem } from "typescript/unstable/fs"
import { API } from "typescript/unstable/sync"

import {
	resolveTypescriptSdkPath,
	type TypescriptRuntimeOptions,
} from "./typescript-runtime.ts"

/** A synchronous, single-owner TypeScript parser session for batched analysis. */
export type TypescriptAstSession = {
	[Symbol.dispose](): void
	close(): void
	withSourceFile<TResult>(
		sourceText: string,
		filePath: string,
		use: (sourceFile: SourceFile) => TResult,
	): TResult
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

			const snapshot = activeApi.updateSnapshot({
				...(previousFilePath && previousFilePath !== normalizedFilePath
					? { closeFiles: [previousFilePath] }
					: {}),
				fileChanges:
					previousFilePath === normalizedFilePath
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

				const sourceFile = snapshot
					.getDefaultProjectForFile(normalizedFilePath)
					?.program.getSourceFile(normalizedFilePath)

				if (!sourceFile) {
					throw new Error(
						`Unable to parse TSX source file ${normalizedFilePath}.`,
					)
				}

				return use(sourceFile)
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
