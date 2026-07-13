export const CSS_MODULE_SUFFIX = `.module.css`
export const TSX_SUFFIX = `.tsx`
export const ASTRO_SUFFIX = `.astro`

export type RenderSourceKind = `astro` | `tsx`

export type RenderSourceCandidate = {
	kind: RenderSourceKind
	path: string
}

export type SiblingRenderSourceResolution =
	| { kind: `missing`; candidates: RenderSourceCandidate[] }
	| { kind: `ready`; source: RenderSourceCandidate }
	| { kind: `ambiguous`; sources: RenderSourceCandidate[] }

export function isCssModulePath(filePath: string): boolean {
	return filePath.endsWith(CSS_MODULE_SUFFIX)
}

export function isAstroPath(filePath: string): boolean {
	return filePath.endsWith(ASTRO_SUFFIX)
}

export function isTsxPath(filePath: string): boolean {
	return filePath.endsWith(TSX_SUFFIX)
}

export function isRenderSourcePath(filePath: string): boolean {
	return isTsxPath(filePath) || isAstroPath(filePath)
}

export function renderSourceKindFromPath(
	filePath: string,
): RenderSourceKind | undefined {
	if (isTsxPath(filePath)) return `tsx`
	if (isAstroPath(filePath)) return `astro`
}

export function siblingRenderSourceCandidates(
	cssPath: string,
): RenderSourceCandidate[] {
	if (!isCssModulePath(cssPath)) return []

	const stem = cssPath.slice(0, -CSS_MODULE_SUFFIX.length)

	return [
		{ kind: `tsx`, path: `${stem}${TSX_SUFFIX}` },
		{ kind: `astro`, path: `${stem}${ASTRO_SUFFIX}` },
	]
}

export function resolveSiblingRenderSource(
	cssPath: string,
	fileExists: (filePath: string) => boolean,
): SiblingRenderSourceResolution {
	const candidates = siblingRenderSourceCandidates(cssPath)
	const sources = candidates.filter((candidate) => fileExists(candidate.path))

	if (sources.length === 0) return { candidates, kind: `missing` }
	if (sources.length === 1 && sources[0]) {
		return { kind: `ready`, source: sources[0] }
	}

	return { kind: `ambiguous`, sources }
}

export function ambiguousRenderSourceMessage(
	cssPath: string,
	sources: readonly RenderSourceCandidate[],
): string {
	const sourcePaths = sources.map((source) => `"${source.path}"`).join(` and `)

	return `Ambiguous render story for "${cssPath}": found both ${sourcePaths}. Keep only one same-named .tsx or .astro neighbor.`
}

export function sourcePathToSiblingCssModulePath(
	sourcePath: string,
): string | undefined {
	const kind = renderSourceKindFromPath(sourcePath)

	if (!kind) return

	const suffix = kind === `tsx` ? TSX_SUFFIX : ASTRO_SUFFIX

	return `${sourcePath.slice(0, -suffix.length)}${CSS_MODULE_SUFFIX}`
}
