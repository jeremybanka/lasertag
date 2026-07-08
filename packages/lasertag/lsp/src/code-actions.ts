export const LASERTAG_RESTART_SERVER_COMMAND = `lasertag.restartServer`
export const LASERTAG_RESTART_SERVER_TITLE = `Lasertag: Restart Lasertag Server`
export const LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE = `Lasertag: Clean up Dead Selectors`

export type OffsetRange = {
	start: number
	end: number
}

type SelectorListItem = OffsetRange

type RuleCleanupContext = {
	blockEnd: number
	openBrace: number
	preludeStart: number
	selectorItems: SelectorListItem[]
	targetIndexes: Set<number>
}

function isWhitespace(character: string): boolean {
	return /\s/.test(character)
}

function trimRange(
	sourceText: string,
	start: number,
	end: number,
): OffsetRange {
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

function rangesOverlap(left: OffsetRange, right: OffsetRange): boolean {
	return left.start < right.end && right.start < left.end
}

function findNextBlockDelimiter(
	sourceText: string,
	start: number,
): { kind: `{` | `;` | `}`; index: number } | undefined {
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = start; index < sourceText.length; index += 1) {
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

function findMatchingBlockEnd(
	sourceText: string,
	openBraceIndex: number,
): number | undefined {
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
}

function findRulePreludeStart(
	sourceText: string,
	selectorStart: number,
): number {
	const previousOpenBrace = sourceText.lastIndexOf(`{`, selectorStart - 1)
	const previousCloseBrace = sourceText.lastIndexOf(`}`, selectorStart - 1)
	const previousSemicolon = sourceText.lastIndexOf(`;`, selectorStart - 1)

	return Math.max(previousOpenBrace, previousCloseBrace, previousSemicolon) + 1
}

function splitSelectorItems(
	sourceText: string,
	start: number,
	end: number,
): SelectorListItem[] {
	const selectors: SelectorListItem[] = []
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined
	let partStart = start

	for (let index = start; index <= end; index += 1) {
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
			(character === `,` || index === end) &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			const selectorRange = trimRange(sourceText, partStart, index)

			if (selectorRange.start < selectorRange.end) {
				selectors.push(selectorRange)
			}

			partStart = index + 1
		}
	}

	return selectors
}

function createRuleContext(
	sourceText: string,
	selectorRange: OffsetRange,
): RuleCleanupContext | undefined {
	const delimiter = findNextBlockDelimiter(sourceText, selectorRange.end)

	if (!delimiter || delimiter.kind !== `{`) return

	const blockEnd = findMatchingBlockEnd(sourceText, delimiter.index)

	if (blockEnd === undefined) return

	const preludeStart = findRulePreludeStart(sourceText, selectorRange.start)
	const selectorItems = splitSelectorItems(
		sourceText,
		preludeStart,
		delimiter.index,
	)
	const targetIndex = selectorItems.findIndex((selectorItem) =>
		rangesOverlap(selectorItem, selectorRange),
	)

	if (targetIndex === -1) return

	return {
		blockEnd,
		openBrace: delimiter.index,
		preludeStart,
		selectorItems,
		targetIndexes: new Set([targetIndex]),
	}
}

function ruleContextKey(context: RuleCleanupContext): string {
	return `${context.preludeStart}:${context.openBrace}:${context.blockEnd}`
}

function createWholeRuleRemovalRange(
	sourceText: string,
	context: RuleCleanupContext,
): OffsetRange {
	const firstSelectorStart =
		context.selectorItems[0]?.start ?? context.preludeStart
	const lineStart = sourceText.lastIndexOf(`\n`, firstSelectorStart - 1) + 1
	const hasOnlyLineIndentation = sourceText
		.slice(lineStart, firstSelectorStart)
		.split(``)
		.every(isWhitespace)
	const start = hasOnlyLineIndentation ? lineStart : context.preludeStart
	let end = context.blockEnd + 1

	if (sourceText.slice(end, end + 2) === `\r\n`) {
		end += 2
	} else if (sourceText[end] === `\n`) {
		end += 1
	}

	return { end, start }
}

function createSelectorListItemRemovalRange(
	context: RuleCleanupContext,
	targetIndex: number,
): OffsetRange {
	const selectorItems = context.selectorItems
	const target = selectorItems[targetIndex]
	const next = selectorItems[targetIndex + 1]
	const previous = selectorItems[targetIndex - 1]

	if (!target) return { end: context.openBrace, start: context.preludeStart }

	if (next) {
		return { end: next.start, start: target.start }
	}

	if (previous) {
		return { end: target.end, start: previous.end }
	}

	return { end: context.openBrace, start: context.preludeStart }
}

function mergeRanges(ranges: OffsetRange[]): OffsetRange[] {
	const sortedRanges = [...ranges]
		.filter((range) => range.start < range.end)
		.sort((left, right) => left.start - right.start || left.end - right.end)
	const mergedRanges: OffsetRange[] = []

	for (const range of sortedRanges) {
		const previous = mergedRanges.at(-1)

		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end)
			continue
		}

		mergedRanges.push({ ...range })
	}

	return mergedRanges
}

export function createDeadSelectorCleanupRanges(
	sourceText: string,
	selectorRanges: OffsetRange[],
): OffsetRange[] {
	const contextsByKey = new Map<string, RuleCleanupContext>()

	for (const selectorRange of selectorRanges) {
		const context = createRuleContext(sourceText, selectorRange)

		if (!context) continue

		const key = ruleContextKey(context)
		const existingContext = contextsByKey.get(key)

		if (existingContext) {
			for (const targetIndex of context.targetIndexes) {
				existingContext.targetIndexes.add(targetIndex)
			}
		} else {
			contextsByKey.set(key, context)
		}
	}

	const cleanupRanges: OffsetRange[] = []

	for (const context of contextsByKey.values()) {
		if (context.targetIndexes.size >= context.selectorItems.length) {
			cleanupRanges.push(createWholeRuleRemovalRange(sourceText, context))
			continue
		}

		for (const targetIndex of [...context.targetIndexes].sort(
			(left, right) => left - right,
		)) {
			cleanupRanges.push(
				createSelectorListItemRemovalRange(context, targetIndex),
			)
		}
	}

	return mergeRanges(cleanupRanges)
}
