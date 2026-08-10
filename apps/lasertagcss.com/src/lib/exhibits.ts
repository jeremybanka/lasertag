export type ExhibitReference = {
	region: string | null
	source: string
}

type RegionMarker = {
	kind: `end` | `start`
	name: string
}

const REGION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function parseExhibitReference(src: string): ExhibitReference {
	const parts = src.split(`#`)
	if (parts.length > 2) {
		throw new Error(`Invalid exhibit source "${src}": use at most one #region.`)
	}

	const source = normalizeExhibitSource(parts[0] ?? ``)
	const region = parts[1] ?? null
	if (source.length === 0) {
		throw new Error(`Invalid exhibit source "${src}": missing source path.`)
	}
	if (region === ``) {
		throw new Error(`Invalid exhibit source "${src}": missing region name.`)
	}
	if (region !== null && !REGION_NAME_PATTERN.test(region)) {
		throw new Error(`Invalid exhibit region "${region}".`)
	}
	return { region, source }
}

export function normalizeExhibitSource(src: string): string {
	return src.replace(/^\/+/, ``).replace(/^src\/exhibits\//, ``)
}

export function extractExhibitCode(
	code: string,
	reference: ExhibitReference,
): string {
	if (reference.region === null) return code

	const lines = code.split(/\r?\n/)
	const captured: string[] = []
	let insideRegion = false
	let foundRegion = false

	for (const line of lines) {
		const marker = readRegionMarker(line)
		if (marker?.kind === `start` && marker.name === reference.region) {
			insideRegion = true
			foundRegion = true
			continue
		}
		if (marker?.kind === `end` && marker.name === reference.region) {
			insideRegion = false
			break
		}
		if (insideRegion) captured.push(line)
	}

	if (!foundRegion || insideRegion) {
		throw new Error(
			`Unknown or unclosed exhibit region "${reference.region}" in ${reference.source}.`,
		)
	}
	return trimRegionLines(captured).join(`\n`)
}

function readRegionMarker(line: string): RegionMarker | null {
	let marker = line.trim()
	for (const prefix of [`<!--`, `//`, `#`, `--`, `/*`, `*`]) {
		if (marker.startsWith(prefix)) {
			marker = marker.slice(prefix.length).trim()
			break
		}
	}
	marker = marker.replace(/(?:-->|\*\/)$/, ``).trim()
	const match = /^@exhibit-region\s+(start|end)\s+(\S+)$/.exec(marker)
	if (!match || !REGION_NAME_PATTERN.test(match[2] ?? ``)) return null
	return { kind: match[1] as `end` | `start`, name: match[2] ?? `` }
}

function trimRegionLines(lines: string[]): string[] {
	while (lines[0]?.trim() === ``) lines.shift()
	while (lines.at(-1)?.trim() === ``) lines.pop()
	const indents = lines
		.filter((line) => line.trim() !== ``)
		.map((line) => line.match(/^\s*/)?.[0] ?? ``)
	let shared = indents[0] ?? ``
	for (const indent of indents.slice(1)) {
		while (!indent.startsWith(shared)) shared = shared.slice(0, -1)
	}
	return shared.length === 0
		? lines
		: lines.map((line) =>
				line.trim() === `` ? line : line.slice(shared.length),
			)
}
