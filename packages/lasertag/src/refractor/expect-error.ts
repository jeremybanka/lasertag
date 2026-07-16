import type { CssReachabilityDiagnostic, SourceRange } from "./diagnostics.ts"

const EXPECT_ERROR_DIRECTIVE = `@lasertag-expect-error`
const MINIMUM_EXPLANATION_LENGTH = 3

type ExpectErrorDirective = {
	explanation: string
	range: SourceRange
	targetLine: number
}

function lineAtOffset(sourceText: string, offset: number): number {
	let line = 0

	for (let index = 0; index < offset; index += 1) {
		if (sourceText[index] === `\n`) line += 1
	}

	return line
}

function parseDirective(
	sourceText: string,
	start: number,
	end: number,
): ExpectErrorDirective | undefined {
	const commentBody = sourceText.slice(start + 2, end - 2).trim()

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
		range: { end, start },
		targetLine: lineAtOffset(sourceText, end) + 1,
	}
}

function findExpectErrorDirectives(sourceText: string): ExpectErrorDirective[] {
	const directives: ExpectErrorDirective[] = []
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

	return findExpectErrorDirectives(sourceText).find(
		(directive) => directive.targetLine === targetLine,
	)?.explanation
}

function directiveDiagnostic(
	code: `expect-error-explanation-too-short` | `unused-expect-error`,
	message: string,
	directive: ExpectErrorDirective,
	sourceText: string,
): CssReachabilityDiagnostic {
	return {
		code,
		message,
		range: directive.range,
		selector: sourceText.slice(directive.range.start, directive.range.end),
	}
}

export function applyLasertagExpectErrorDirectives(
	sourceText: string,
	diagnostics: CssReachabilityDiagnostic[],
): CssReachabilityDiagnostic[] {
	const directives = findExpectErrorDirectives(sourceText)

	if (directives.length === 0) return diagnostics

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
