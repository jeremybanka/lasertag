import path from "node:path"
import type { FileSystem } from "typescript/unstable/fs"
import { API } from "typescript/unstable/sync"
import type { SourceFile } from "typescript/unstable/ast"

function normalizeFilePath(filePath: string): string {
	return path.resolve(filePath)
}

function createSingleFileSystem(
	filePath: string,
	sourceText: string,
): FileSystem {
	return {
		fileExists(candidate) {
			return normalizeFilePath(candidate) === filePath ? true : undefined
		},
		readFile(candidate) {
			return normalizeFilePath(candidate) === filePath ? sourceText : undefined
		},
		realpath(candidate) {
			return normalizeFilePath(candidate) === filePath ? filePath : undefined
		},
	}
}

export function createTsxSourceFile(
	sourceText: string,
	filePath = `component.tsx`,
): SourceFile {
	const normalizedFilePath = normalizeFilePath(filePath)
	const api = new API({
		cwd: path.dirname(normalizedFilePath),
		fs: createSingleFileSystem(normalizedFilePath, sourceText),
	})

	try {
		const snapshot = api.updateSnapshot({ openFiles: [normalizedFilePath] })

		try {
			const sourceFile = snapshot
				.getDefaultProjectForFile(normalizedFilePath)
				?.program.getSourceFile(normalizedFilePath)

			if (!sourceFile) {
				throw new Error(
					`Unable to parse TSX source file ${normalizedFilePath}.`,
				)
			}

			return sourceFile
		} finally {
			snapshot.dispose()
		}
	} finally {
		api.close()
	}
}
