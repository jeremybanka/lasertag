import type { SelectorPath, SourceRange } from "./diagnostics.ts"

export type CssSelectorAnalysis = {
	selector: string
	range: SourceRange
	result:
		| {
				kind: `path`
				path: SelectorPath
		  }
		| {
				kind: `impossible-local-class`
				className: string
		  }
		| {
				kind: `unknown`
				reason: string
		  }
}

type CssRule = {
	selectorText: string
	selectorRange: SourceRange
	children: CssRule[]
}

type SelectorWithRange = {
	text: string
	range: SourceRange
}

type TokenizedSelectorPart = {
	relation: `self` | `child` | `descendant`
	compound: string
}

function isWhitespace(character: string): boolean {
	return /\s/.test(character)
}

function skipWhitespaceAndComments(sourceText: string, index: number): number {
	let cursor = index

	while (cursor < sourceText.length) {
		const character = sourceText[cursor]
		const nextCharacter = sourceText[cursor + 1]

		if (character && isWhitespace(character)) {
			cursor += 1
			continue
		}

		if (character === `/` && nextCharacter === `*`) {
			const commentEnd = sourceText.indexOf(`*/`, cursor + 2)

			if (commentEnd === -1) return sourceText.length

			cursor = commentEnd + 2
			continue
		}

		break
	}

	return cursor
}

function findBlockEnd(sourceText: string, openBraceIndex: number): number {
	let depth = 0
	let quote: `"` | `'` | undefined

	for (let index = openBraceIndex; index < sourceText.length; index += 1) {
		const character = sourceText[index]
		const previousCharacter = sourceText[index - 1]

		if (quote) {
			if (character === quote && previousCharacter !== `\\`) {
				quote = undefined
			}

			continue
		}

		if (character === `"` || character === `'`) {
			quote = character
			continue
		}

		if (character === `/` && sourceText[index + 1] === `*`) {
			const commentEnd = sourceText.indexOf(`*/`, index + 2)

			if (commentEnd === -1) return sourceText.length - 1

			index = commentEnd + 1
			continue
		}

		if (character === `{`) {
			depth += 1
			continue
		}

		if (character === `}`) {
			depth -= 1

			if (depth === 0) return index
		}
	}

	return sourceText.length - 1
}

function findNextBlockDelimiter(
	sourceText: string,
	start: number,
	end: number,
): { kind: `{` | `;` | `}`; index: number } | undefined {
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = start; index < end; index += 1) {
		const character = sourceText[index]
		const previousCharacter = sourceText[index - 1]

		if (quote) {
			if (character === quote && previousCharacter !== `\\`) {
				quote = undefined
			}

			continue
		}

		if (character === `"` || character === `'`) {
			quote = character
			continue
		}

		if (character === `/` && sourceText[index + 1] === `*`) {
			const commentEnd = sourceText.indexOf(`*/`, index + 2)

			if (commentEnd === -1) return

			index = commentEnd + 1
			continue
		}

		if (character === `(`) {
			parenDepth += 1
			continue
		}

		if (character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			continue
		}

		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (parenDepth > 0 || bracketDepth > 0) continue

		if (character === `{` || character === `;` || character === `}`) {
			return { kind: character, index }
		}
	}
}

function trimRange(
	sourceText: string,
	start: number,
	end: number,
): SourceRange {
	let trimmedStart = start
	let trimmedEnd = end

	while (
		trimmedStart < trimmedEnd &&
		isWhitespace(sourceText[trimmedStart] ?? ``)
	) {
		trimmedStart += 1
	}

	while (
		trimmedEnd > trimmedStart &&
		isWhitespace(sourceText[trimmedEnd - 1] ?? ``)
	) {
		trimmedEnd -= 1
	}

	return { start: trimmedStart, end: trimmedEnd }
}

function parseRules(sourceText: string, start: number, end: number): CssRule[] {
	const rules: CssRule[] = []
	let cursor = start

	while (cursor < end) {
		cursor = skipWhitespaceAndComments(sourceText, cursor)

		if (cursor >= end || sourceText[cursor] === `}`) break

		const preludeStart = cursor
		const delimiter = findNextBlockDelimiter(sourceText, cursor, end)

		if (!delimiter) break

		if (delimiter.kind === `;`) {
			cursor = delimiter.index + 1
			continue
		}

		if (delimiter.kind === `}`) {
			break
		}

		const selectorRange = trimRange(sourceText, preludeStart, delimiter.index)
		const selectorText = sourceText.slice(
			selectorRange.start,
			selectorRange.end,
		)
		const blockEnd = findBlockEnd(sourceText, delimiter.index)
		const children = parseRules(sourceText, delimiter.index + 1, blockEnd)

		if (selectorText.startsWith(`@`)) {
			rules.push(...children)
		} else if (selectorText.length > 0) {
			rules.push({ selectorText, selectorRange, children })
		}

		cursor = blockEnd + 1
	}

	return rules
}

function splitSelectorList(
	selector: string,
	range: SourceRange,
): SelectorWithRange[] {
	const selectors: SelectorWithRange[] = []
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined
	let partStart = 0

	for (let index = 0; index <= selector.length; index += 1) {
		const character = selector[index]
		const previousCharacter = selector[index - 1]

		if (quote) {
			if (character === quote && previousCharacter !== `\\`) {
				quote = undefined
			}

			continue
		}

		if (character === `"` || character === `'`) {
			quote = character
			continue
		}

		if (character === `(`) {
			parenDepth += 1
			continue
		}

		if (character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			continue
		}

		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (
			(character === `,` || index === selector.length) &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			const partRange = trimRange(selector, partStart, index)
			const text = selector.slice(partRange.start, partRange.end)

			if (text.length > 0) {
				selectors.push({
					text,
					range: {
						start: range.start + partRange.start,
						end: range.start + partRange.end,
					},
				})
			}

			partStart = index + 1
		}
	}

	return selectors
}

function combineSelectors(
	parentSelector: string,
	nestedSelector: string,
): string {
	if (nestedSelector.includes(`&`)) {
		return nestedSelector.replaceAll(`&`, parentSelector)
	}

	if (nestedSelector.startsWith(`>`)) {
		return `${parentSelector} ${nestedSelector}`
	}

	return `${parentSelector} ${nestedSelector}`
}

function flattenRules(
	rules: CssRule[],
	parentSelectors: string[] = [],
): SelectorWithRange[] {
	const selectors: SelectorWithRange[] = []

	for (const rule of rules) {
		const ruleSelectors = splitSelectorList(
			rule.selectorText,
			rule.selectorRange,
		)
		const combinedSelectors =
			parentSelectors.length === 0
				? ruleSelectors
				: parentSelectors.flatMap((parentSelector) =>
						ruleSelectors.map((selector) => ({
							text: combineSelectors(parentSelector, selector.text),
							range: selector.range,
						})),
					)

		selectors.push(...combinedSelectors)
		selectors.push(
			...flattenRules(
				rule.children,
				combinedSelectors.map((selector) => selector.text),
			),
		)
	}

	return selectors
}

function hasUnsupportedGlobalSelector(selector: string): boolean {
	return selector.includes(`:global(`)
}

function hasUnsupportedSelectorSyntax(selector: string): string | undefined {
	let parenDepth = 0
	let bracketDepth = 0

	for (let index = 0; index < selector.length; index += 1) {
		const character = selector[index]

		if (character === `(`) {
			parenDepth += 1
			continue
		}

		if (character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			continue
		}

		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (parenDepth > 0 || bracketDepth > 0) continue

		if (character === `+` || character === `~`) {
			return `sibling combinator`
		}
	}

	if (selector.includes(`:has(`)) return `:has()`

	return undefined
}

function tokenizeSelector(selector: string): TokenizedSelectorPart[] {
	const parts: TokenizedSelectorPart[] = []
	let relation: `self` | `child` | `descendant` = `self`
	let compound = ``
	let parenDepth = 0
	let bracketDepth = 0

	function pushCompound() {
		const trimmedCompound = compound.trim()

		if (trimmedCompound.length === 0) return

		parts.push({ relation, compound: trimmedCompound })
		compound = ``
		relation = `descendant`
	}

	for (let index = 0; index < selector.length; index += 1) {
		const character = selector[index] ?? ``

		if (character === `(`) {
			parenDepth += 1
			compound += character
			continue
		}

		if (character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			compound += character
			continue
		}

		if (character === `[`) {
			bracketDepth += 1
			compound += character
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			compound += character
			continue
		}

		if (parenDepth > 0 || bracketDepth > 0) {
			compound += character
			continue
		}

		if (character === `>`) {
			pushCompound()
			relation = `child`
			continue
		}

		if (isWhitespace(character)) {
			pushCompound()
			relation = relation === `child` ? `child` : `descendant`
			continue
		}

		compound += character
	}

	pushCompound()

	return parts
}

function readIdentifier(text: string, start: number): string {
	let end = start

	while (end < text.length && /[-_a-zA-Z0-9]/.test(text[end] ?? ``)) {
		end += 1
	}

	return text.slice(start, end)
}

function stripBracketSections(text: string): string {
	let stripped = ``
	let bracketDepth = 0

	for (const character of text) {
		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (bracketDepth === 0) stripped += character
	}

	return stripped
}

function getCompoundClasses(compound: string): string[] {
	const classes: string[] = []
	const stripped = stripBracketSections(compound)

	for (let index = 0; index < stripped.length; index += 1) {
		if (stripped[index] !== `.`) continue

		const className = readIdentifier(stripped, index + 1)

		if (className.length > 0) {
			classes.push(className)
			index += className.length
		}
	}

	return classes
}

function getCompoundTagName(compound: string): string | undefined {
	const stripped = stripBracketSections(compound).trim()

	if (stripped.startsWith(`*`)) return

	if (!/^[-_a-zA-Z]/.test(stripped)) return

	const tagName = readIdentifier(stripped, 0)

	return tagName.length > 0 ? tagName : undefined
}

function parseSelectorPath(selector: string): CssSelectorAnalysis[`result`] {
	if (hasUnsupportedGlobalSelector(selector)) {
		return { kind: `unknown`, reason: `global selector` }
	}

	const unsupportedReason = hasUnsupportedSelectorSyntax(selector)

	if (unsupportedReason) {
		return { kind: `unknown`, reason: unsupportedReason }
	}

	const parts = tokenizeSelector(selector)

	if (parts.length === 0) {
		return { kind: `unknown`, reason: `empty selector` }
	}

	const path: SelectorPath = []

	for (const [index, part] of parts.entries()) {
		const classes = getCompoundClasses(part.compound)

		for (const className of classes) {
			if (!(index === 0 && className === `class`)) {
				return { kind: `impossible-local-class`, className }
			}
		}

		const tagName = getCompoundTagName(part.compound)

		if (!tagName) {
			return { kind: `unknown`, reason: `selector segment without tag` }
		}

		path.push({ relation: index === 0 ? `self` : part.relation, tagName })
	}

	return { kind: `path`, path }
}

export function analyzeCssModuleSelectors(
	sourceText: string,
): CssSelectorAnalysis[] {
	return flattenRules(parseRules(sourceText, 0, sourceText.length)).map(
		(selector) => ({
			selector: selector.text,
			range: selector.range,
			result: parseSelectorPath(selector.text),
		}),
	)
}
