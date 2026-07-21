import type { SelectorPath, SourceRange } from "./diagnostics.ts"

export type CssSelectorAnalysis = {
	selector: string
	range: SourceRange
	result:
		| {
				kind: `path`
				paths: SelectorPath[]
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

const MAX_SELECTOR_PATHS = 128

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
			const partRange = trimRange(
				selector,
				skipWhitespaceAndComments(selector, partStart),
				index,
			)
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

		if (character === `|`) {
			return `namespace selector`
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

function stripBalancedSections(
	text: string,
	options: { brackets?: boolean; parentheses?: boolean },
): string {
	let stripped = ``
	let bracketDepth = 0
	let parenDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index]
		const previousCharacter = text[index - 1]

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

		if (options.brackets && character === `[`) {
			bracketDepth += 1
			continue
		}

		if (options.brackets && character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (options.parentheses && character === `(`) {
			parenDepth += 1
			continue
		}

		if (options.parentheses && character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			continue
		}

		if (bracketDepth === 0 && parenDepth === 0 && character) {
			stripped += character
		}
	}

	return stripped
}

function stripNonStructuralSections(text: string): string {
	return stripBalancedSections(text, { brackets: true, parentheses: true })
}

function getCompoundClasses(compound: string): string[] {
	const classes: string[] = []
	const stripped = stripNonStructuralSections(compound)

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
	const stripped = stripNonStructuralSections(compound).trim()

	if (stripped.startsWith(`*`)) return `*`

	if (!/^[-_a-zA-Z]/.test(stripped)) return

	const tagName = readIdentifier(stripped, 0)

	return tagName.length > 0 ? tagName : undefined
}

function findMatchingParen(text: string, openParenIndex: number): number {
	let depth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = openParenIndex; index < text.length; index += 1) {
		const character = text[index]
		const previousCharacter = text[index - 1]

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

		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (bracketDepth > 0) continue

		if (character === `(`) {
			depth += 1
			continue
		}

		if (character === `)`) {
			depth -= 1

			if (depth === 0) return index
		}
	}

	return -1
}

function findFunctionalAlternativePseudo(compound: string):
	| {
			start: number
			end: number
			argumentsText: string
	  }
	| undefined {
	let bracketDepth = 0
	let parenDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = 0; index < compound.length; index += 1) {
		const character = compound[index]
		const previousCharacter = compound[index - 1]

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

		if (character === `[`) {
			bracketDepth += 1
			continue
		}

		if (character === `]`) {
			bracketDepth = Math.max(bracketDepth - 1, 0)
			continue
		}

		if (bracketDepth > 0) continue

		if (character === `(`) {
			parenDepth += 1
			continue
		}

		if (character === `)`) {
			parenDepth = Math.max(parenDepth - 1, 0)
			continue
		}

		if (parenDepth > 0) continue

		for (const pseudoName of [`is`, `where`] as const) {
			const prefix = `:${pseudoName}(`

			if (!compound.startsWith(prefix, index)) continue

			const openParenIndex = index + prefix.length - 1
			const closeParenIndex = findMatchingParen(compound, openParenIndex)

			if (closeParenIndex === -1) {
				return
			}

			return {
				start: index,
				end: closeParenIndex + 1,
				argumentsText: compound.slice(openParenIndex + 1, closeParenIndex),
			}
		}
	}
}

function withoutLeadingTag(compound: string, tagName: string): string {
	const trimmed = compound.trim()

	return trimmed.slice(tagName.length)
}

function mergeCompoundAlternative(
	prefix: string,
	alternative: string,
	suffix: string,
): string | undefined {
	const base = `${prefix}${suffix}`
	const baseTagName = getCompoundTagName(base)
	const alternativeTagName = getCompoundTagName(alternative)

	if (!alternativeTagName) {
		return `${prefix}${alternative}${suffix}`
	}

	const alternativeRest = withoutLeadingTag(alternative, alternativeTagName)

	if (!baseTagName) {
		return `${alternativeTagName}${prefix}${alternativeRest}${suffix}`
	}

	if (baseTagName !== alternativeTagName) {
		return
	}

	return `${prefix}${alternativeRest}${suffix}`
}

function expandCompoundAlternatives(compound: string):
	| {
			kind: `compounds`
			compounds: string[]
	  }
	| {
			kind: `unknown`
			reason: string
	  } {
	let compounds = [compound]

	while (true) {
		let expanded = false
		const nextCompounds: string[] = []

		for (const currentCompound of compounds) {
			const pseudo = findFunctionalAlternativePseudo(currentCompound)

			if (!pseudo) {
				nextCompounds.push(currentCompound)
				continue
			}

			expanded = true

			const prefix = currentCompound.slice(0, pseudo.start)
			const suffix = currentCompound.slice(pseudo.end)
			const alternatives = splitSelectorList(pseudo.argumentsText, {
				start: 0,
				end: pseudo.argumentsText.length,
			})

			if (alternatives.length === 0) {
				return { kind: `unknown`, reason: `empty functional pseudo-class` }
			}

			for (const alternative of alternatives) {
				const parts = tokenizeSelector(alternative.text)

				if (parts.length !== 1) {
					return {
						kind: `unknown`,
						reason: `complex functional pseudo-class selector`,
					}
				}

				const part = parts[0]

				if (!part || part.relation !== `self`) {
					return {
						kind: `unknown`,
						reason: `complex functional pseudo-class selector`,
					}
				}

				const merged = mergeCompoundAlternative(prefix, part.compound, suffix)

				if (!merged) {
					return {
						kind: `unknown`,
						reason: `conflicting functional pseudo-class tag`,
					}
				}

				nextCompounds.push(merged)
			}
		}

		if (!expanded) {
			return { kind: `compounds`, compounds }
		}

		const dedupedCompounds = [...new Set(nextCompounds)]

		if (dedupedCompounds.length > MAX_SELECTOR_PATHS) {
			return { kind: `unknown`, reason: `too many selector alternatives` }
		}

		compounds = dedupedCompounds
	}
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

	let paths: SelectorPath[] = [[]]
	let impossibleClassName: string | undefined

	for (const [index, part] of parts.entries()) {
		const expansion = expandCompoundAlternatives(part.compound)

		if (expansion.kind === `unknown`) return expansion

		const segmentOptions: SelectorPath[number][] = []

		for (const compound of expansion.compounds) {
			const classes = getCompoundClasses(compound)
			const invalidClassName = classes.find(
				(className) => !(index === 0 && className === `class`),
			)

			if (invalidClassName) {
				impossibleClassName ??= invalidClassName
				continue
			}

			const tagName = getCompoundTagName(compound)

			if (!tagName) {
				return { kind: `unknown`, reason: `selector segment without tag` }
			}

			segmentOptions.push({
				relation: index === 0 ? `self` : part.relation,
				tagName,
			})
		}

		if (segmentOptions.length === 0) {
			return impossibleClassName
				? { kind: `impossible-local-class`, className: impossibleClassName }
				: { kind: `unknown`, reason: `selector segment without tag` }
		}

		paths = paths.flatMap((path) =>
			segmentOptions.map((segment) => [...path, segment]),
		)

		if (paths.length > MAX_SELECTOR_PATHS) {
			return { kind: `unknown`, reason: `too many selector paths` }
		}
	}

	return { kind: `path`, paths }
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
