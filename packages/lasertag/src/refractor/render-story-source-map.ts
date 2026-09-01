import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type DeclarationSource = {
	filePath: string
	sourceText: string
}

export type MappedRenderSource = {
	filePath: string
	sourceText: string
}

type RawSourceMap = {
	sourceRoot?: unknown
	sources?: unknown
	sourcesContent?: unknown
}

function sourceMappingUrl(sourceText: string): string | undefined {
	const matches = sourceText.matchAll(
		/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)(?:\s*\*\/)?/g,
	)
	let lastMatch: RegExpMatchArray | undefined

	for (const match of matches) lastMatch = match

	return lastMatch?.[1]
}

function parseDataUrl(url: string): string | undefined {
	const match = url.match(
		/^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/s,
	)

	if (!match?.[2]) return

	try {
		return match[1]
			? Buffer.from(match[2], `base64`).toString(`utf8`)
			: decodeURIComponent(match[2])
	} catch {
		return
	}
}

function sourceMapText(
	declarationPath: string,
	url: string,
): { mapPath: string; sourceText: string } | undefined {
	const inlineSource = parseDataUrl(url)

	if (inlineSource !== undefined) {
		return { mapPath: declarationPath, sourceText: inlineSource }
	}

	if (/^[a-z][a-z+.-]*:/i.test(url) && !url.startsWith(`file:`)) return

	let mapPath: string

	try {
		mapPath = url.startsWith(`file:`)
			? fileURLToPath(url)
			: path.resolve(path.dirname(declarationPath), url)
	} catch {
		return
	}

	try {
		return { mapPath, sourceText: readFileSync(mapPath, `utf8`) }
	} catch {
		return
	}
}

function parseSourceMap(sourceText: string): RawSourceMap | undefined {
	try {
		const parsed: unknown = JSON.parse(sourceText)

		return parsed && typeof parsed === `object`
			? (parsed as RawSourceMap)
			: undefined
	} catch {
		return
	}
}

function mappedSourcePath(
	mapPath: string,
	sourceRoot: string,
	source: string,
): string | undefined {
	if (/^[a-z][a-z+.-]*:/i.test(source) && !source.startsWith(`file:`)) return
	if (/^[a-z][a-z+.-]*:/i.test(sourceRoot) && !sourceRoot.startsWith(`file:`)) {
		return
	}

	try {
		if (source.startsWith(`file:`)) return fileURLToPath(source)

		const rootPath = sourceRoot.startsWith(`file:`)
			? fileURLToPath(sourceRoot)
			: path.resolve(path.dirname(mapPath), sourceRoot)

		return path.resolve(rootPath, source)
	} catch {
		return
	}
}

function isJsxSourcePath(filePath: string): boolean {
	return /\.[jt]sx$/i.test(filePath)
}

function sourcesFromDeclaration(
	declaration: DeclarationSource,
): MappedRenderSource[] {
	const mapUrl = sourceMappingUrl(declaration.sourceText)

	if (!mapUrl) return []

	const mapSource = sourceMapText(declaration.filePath, mapUrl)
	const sourceMap = mapSource ? parseSourceMap(mapSource.sourceText) : undefined

	if (!mapSource || !sourceMap || !Array.isArray(sourceMap.sources)) return []

	const sourceRoot =
		typeof sourceMap.sourceRoot === `string` ? sourceMap.sourceRoot : ``
	const sourcesContent = Array.isArray(sourceMap.sourcesContent)
		? sourceMap.sourcesContent
		: []

	return sourceMap.sources.flatMap((source, index): MappedRenderSource[] => {
		if (typeof source !== `string`) return []

		const filePath = mappedSourcePath(mapSource.mapPath, sourceRoot, source)

		if (!filePath || !isJsxSourcePath(filePath)) return []

		const embeddedSource = sourcesContent[index]

		if (typeof embeddedSource === `string`) {
			return [{ filePath, sourceText: embeddedSource }]
		}

		if (!existsSync(filePath)) return []

		try {
			return [{ filePath, sourceText: readFileSync(filePath, `utf8`) }]
		} catch {
			return []
		}
	})
}

/**
 * Finds original JSX/TSX only through declaration source-map metadata. This
 * avoids inferring source paths from emitted filenames or package layout
 * conventions.
 */
export function mappedRenderSourcesFromDeclarations(
	declarations: readonly DeclarationSource[],
): MappedRenderSource[] {
	const sources = new Map<string, MappedRenderSource>()

	for (const declaration of declarations) {
		for (const source of sourcesFromDeclaration(declaration)) {
			sources.set(source.filePath, source)
		}
	}

	return [...sources.values()].toSorted((left, right) =>
		left.filePath.localeCompare(right.filePath),
	)
}
