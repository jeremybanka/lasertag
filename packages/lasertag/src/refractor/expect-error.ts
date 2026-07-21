import type { CssReachabilityDiagnostic, SourceRange } from "./diagnostics.ts"

const EXPECT_ERROR_DIRECTIVE = `@lasertag-expect-error`
const DISABLE_DIRECTIVE = `@lasertag-disable`
const ENABLE_DIRECTIVE = `@lasertag-enable`
const MINIMUM_EXPLANATION_LENGTH = 3

type ExpectErrorDirective = {
	explanation: string
	kind: `expect-error`
	range: SourceRange
	targetLine: number
}

type DisableDirective = {
	diagnosticCode: string
	explanation: string
	kind: `disable`
	range: SourceRange
}

type EnableDirective = {
	diagnosticCode: string
	kind: `enable`
	range: SourceRange
}

type RegionDirective = DisableDirective | EnableDirective

type LasertagDirective = ExpectErrorDirective | RegionDirective

function lineAtOffset(sourceText: string, offset: number): number {
	let line = 0

	for (let index = 0; index < offset; index += 1) {
		if (sourceText[index] === `\n`) line += 1
	}

	return line
}

function hasDirectivePrefix(commentBody: string, directive: string): boolean {
	if (!commentBody.startsWith(directive)) return false

	const firstCharacter = commentBody[directive.length]

	return firstCharacter === undefined || /\s/.test(firstCharacter)
}

function parseExpectErrorDirective(
	commentBody: string,
	sourceText: string,
	start: number,
	end: number,
): ExpectErrorDirective | undefined {
	if (!commentBody.startsWith(EXPECT_ERROR_DIRECTIVE)) return

	const remainder = commentBody.slice(EXPECT_ERROR_DIRECTIVE.length)
	const firstCharacter = remainder[0]

	if (firstCharacter && firstCharacter !== `:` && !/\s/.test(firstCharacter)) {
		return
	}

	const trimmedRemainder = remainder.trimStart()
	const explanation = trimmedRemainder.startsWith(`:`)
		? trimmedRemainder.slice(1).trim()
		: ``

	return {
		explanation,
		kind: `expect-error`,
		range: { end, start },
		targetLine: lineAtOffset(sourceText, end) + 1,
	}
}

function parseRegionDirective(
	commentBody: string,
	start: number,
	end: number,
): RegionDirective | undefined {
	if (hasDirectivePrefix(commentBody, DISABLE_DIRECTIVE)) {
		const remainder = commentBody.slice(DISABLE_DIRECTIVE.length)
		const match = remainder.match(/^\s*\[([a-z][a-z0-9-]*)\](?:\s+(.*))?$/)

		if (!match?.[1]) return

		return {
			diagnosticCode: match[1],
			explanation: match[2]?.trim() ?? ``,
			kind: `disable`,
			range: { end, start },
		}
	}

	if (!hasDirectivePrefix(commentBody, ENABLE_DIRECTIVE)) return

	const remainder = commentBody.slice(ENABLE_DIRECTIVE.length)
	const match = remainder.match(/^\s*\[([a-z][a-z0-9-]*)\]$/)

	if (!match?.[1]) return

	return {
		diagnosticCode: match[1],
		kind: `enable`,
		range: { end, start },
	}
}

function parseDirective(
	sourceText: string,
	start: number,
	end: number,
): LasertagDirective | undefined {
	const commentBody = sourceText.slice(start + 2, end - 2).trim()

	return (
		parseExpectErrorDirective(commentBody, sourceText, start, end) ??
		parseRegionDirective(commentBody, start, end)
	)
}

function findLasertagDirectives(sourceText: string): LasertagDirective[] {
	const directives: LasertagDirective[] = []
	let quote: `"` | `'` | undefined

	for (let index = 0; index < sourceText.length; index += 1) {
		const character = sourceText[index]
		const previousCharacter = sourceText[index - 1]

		if (quote) {
			if (character === quote && previousCharacter !== `\\`) quote = undefined
			continue
		}

		if (character === `"` || character === `'`) {
			quote = character
			continue
		}

		if (character !== `/` || sourceText[index + 1] !== `*`) continue

		const commentEnd = sourceText.indexOf(`*/`, index + 2)

		if (commentEnd === -1) break

		const end = commentEnd + 2
		const directive = parseDirective(sourceText, index, end)

		if (directive) directives.push(directive)
		index = end - 1
	}

	return directives
}

export function findLasertagExpectErrorExplanation(
	sourceText: string,
	targetOffset: number,
): string | undefined {
	const targetLine = lineAtOffset(sourceText, targetOffset)

	return findLasertagDirectives(sourceText).find(
		(directive): directive is ExpectErrorDirective =>
			directive.kind === `expect-error` && directive.targetLine === targetLine,
	)?.explanation
}

function directiveDiagnostic(
	code:
		| `disable-explanation-too-short`
		| `expect-error-explanation-too-short`
		| `unused-disable`
		| `unused-enable`
		| `unused-expect-error`,
	message: string,
	directive: LasertagDirective,
	sourceText: string,
): CssReachabilityDiagnostic {
	return {
		code,
		message,
		range: directive.range,
		selector: sourceText.slice(directive.range.start, directive.range.end),
	}
}

function applyExpectErrorDirectives(
	sourceText: string,
	diagnostics: CssReachabilityDiagnostic[],
	directives: ExpectErrorDirective[],
): CssReachabilityDiagnostic[] {
	const suppressedDiagnostics = new Set<CssReachabilityDiagnostic>()
	const directiveDiagnostics: CssReachabilityDiagnostic[] = []

	for (const directive of directives) {
		const matchingDiagnostics = diagnostics.filter(
			(diagnostic) =>
				diagnostic.range !== undefined &&
				lineAtOffset(sourceText, diagnostic.range.start) ===
					directive.targetLine,
		)

		for (const diagnostic of matchingDiagnostics) {
			suppressedDiagnostics.add(diagnostic)
		}

		if (directive.explanation.length < MINIMUM_EXPLANATION_LENGTH) {
			directiveDiagnostics.push(
				directiveDiagnostic(
					`expect-error-explanation-too-short`,
					`An "${EXPECT_ERROR_DIRECTIVE}" directive must include an explanation of at least three characters after the colon.`,
					directive,
					sourceText,
				),
			)
		}

		if (matchingDiagnostics.length === 0) {
			directiveDiagnostics.push(
				directiveDiagnostic(
					`unused-expect-error`,
					`Unused "${EXPECT_ERROR_DIRECTIVE}" directive.`,
					directive,
					sourceText,
				),
			)
		}
	}

	return [
		...diagnostics.filter(
			(diagnostic) => !suppressedDiagnostics.has(diagnostic),
		),
		...directiveDiagnostics,
	].sort(
		(left, right) =>
			(left.range?.start ?? 0) - (right.range?.start ?? 0) ||
			(left.range?.end ?? 0) - (right.range?.end ?? 0),
	)
}

function applyRegionDirectives(
	sourceText: string,
	diagnostics: CssReachabilityDiagnostic[],
	directives: RegionDirective[],
): CssReachabilityDiagnostic[] {
	const activeDisables = new Map<string, DisableDirective>()
	const directiveDiagnostics: CssReachabilityDiagnostic[] = []
	const suppressedDiagnostics = new Set<CssReachabilityDiagnostic>()

	function closeRegion(diagnosticCode: string, endOffset: number): void {
		const disableDirective = activeDisables.get(diagnosticCode)

		if (!disableDirective) return

		const matchingDiagnostics = diagnostics.filter(
			(diagnostic) =>
				diagnostic.code === diagnosticCode &&
				diagnostic.range !== undefined &&
				diagnostic.range.start >= disableDirective.range.end &&
				diagnostic.range.start < endOffset,
		)

		for (const diagnostic of matchingDiagnostics) {
			suppressedDiagnostics.add(diagnostic)
		}

		if (matchingDiagnostics.length === 0) {
			directiveDiagnostics.push(
				directiveDiagnostic(
					`unused-disable`,
					`Unused "${DISABLE_DIRECTIVE} [${diagnosticCode}]" directive; no "${diagnosticCode}" diagnostics occur before it is enabled.`,
					disableDirective,
					sourceText,
				),
			)
		}

		activeDisables.delete(diagnosticCode)
	}

	for (const directive of directives) {
		if (directive.kind === `enable`) {
			if (!activeDisables.has(directive.diagnosticCode)) {
				directiveDiagnostics.push(
					directiveDiagnostic(
						`unused-enable`,
						`Unused "${ENABLE_DIRECTIVE} [${directive.diagnosticCode}]" directive; "${directive.diagnosticCode}" diagnostics are not disabled.`,
						directive,
						sourceText,
					),
				)
				continue
			}

			closeRegion(directive.diagnosticCode, directive.range.start)
			continue
		}

		if (directive.explanation.length < MINIMUM_EXPLANATION_LENGTH) {
			directiveDiagnostics.push(
				directiveDiagnostic(
					`disable-explanation-too-short`,
					`A "${DISABLE_DIRECTIVE}" directive must include an explanation of at least three characters after the diagnostic code.`,
					directive,
					sourceText,
				),
			)
		}

		if (activeDisables.has(directive.diagnosticCode)) {
			directiveDiagnostics.push(
				directiveDiagnostic(
					`unused-disable`,
					`Unused "${DISABLE_DIRECTIVE} [${directive.diagnosticCode}]" directive; "${directive.diagnosticCode}" diagnostics are already disabled.`,
					directive,
					sourceText,
				),
			)
			continue
		}

		activeDisables.set(directive.diagnosticCode, directive)
	}

	for (const diagnosticCode of [...activeDisables.keys()]) {
		closeRegion(diagnosticCode, sourceText.length)
	}

	return [
		...diagnostics.filter(
			(diagnostic) => !suppressedDiagnostics.has(diagnostic),
		),
		...directiveDiagnostics,
	].sort(
		(left, right) =>
			(left.range?.start ?? 0) - (right.range?.start ?? 0) ||
			(left.range?.end ?? 0) - (right.range?.end ?? 0),
	)
}

export function applyLasertagSuppressionDirectives(
	sourceText: string,
	diagnostics: CssReachabilityDiagnostic[],
): CssReachabilityDiagnostic[] {
	const directives = findLasertagDirectives(sourceText)

	if (directives.length === 0) return diagnostics

	const expectErrorDirectives = directives.filter(
		(directive): directive is ExpectErrorDirective =>
			directive.kind === `expect-error`,
	)
	const regionDirectives = directives.filter(
		(directive): directive is RegionDirective =>
			directive.kind === `disable` || directive.kind === `enable`,
	)

	return applyRegionDirectives(
		sourceText,
		applyExpectErrorDirectives(sourceText, diagnostics, expectErrorDirectives),
		regionDirectives,
	)
}
