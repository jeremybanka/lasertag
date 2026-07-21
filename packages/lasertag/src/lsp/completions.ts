import {
	CompletionItemKind,
	InsertTextFormat,
	type CompletionItem,
} from "vscode-languageserver/node"

import type {
	RenderStory,
	StoryAttribute,
	StoryChild,
	StoryNode,
} from "../refractor/index.ts"

type CompletionContext =
	| {
			kind: `attribute-name`
			tagNames: string[]
	  }
	| {
			attributeName: string
			kind: `attribute-value`
			tagNames: string[]
	  }
	| {
			kind: `selector`
			selectorTexts: string[]
	  }

type SelectorPathContext = {
	path: string[]
	relation: `child` | `descendant` | `root` | `self`
}

const MODULE_CLASS_NAME = `class`
const EXPECT_ERROR_DIRECTIVE = `@lasertag-expect-error`
const EXPECT_ERROR_COMMENT_START = `/* ${EXPECT_ERROR_DIRECTIVE}: `
const REGION_DIRECTIVE_COMPLETIONS = [
	{
		directive: `@lasertag-disable`,
		diagnosticCodePlaceholder: `\${1|dead-selector,impossible-local-class,selector-crosses-ownership-boundary|}`,
	},
	{
		directive: `@lasertag-enable`,
		diagnosticCodePlaceholder: `\${1|dead-selector,impossible-local-class,selector-crosses-ownership-boundary|}`,
	},
] as const
const REFINEMENT_COMPLETIONS = [
	`:hover`,
	`:focus-visible`,
	`::before`,
	`::after`,
]
const GLOBAL_COMPLETIONS: CompletionItem[] = [
	{
		insertText: `:global(.$1)`,
		insertTextFormat: InsertTextFormat.Snippet,
		kind: CompletionItemKind.Snippet,
		label: `:global(.)`,
	},
	{
		insertText: `:global($1)`,
		insertTextFormat: InsertTextFormat.Snippet,
		kind: CompletionItemKind.Snippet,
		label: `:global(...)`,
	},
]
const FUNCTIONAL_REFINEMENT_COMPLETIONS: CompletionItem[] = [
	{
		insertText: `:is($1)`,
		insertTextFormat: InsertTextFormat.Snippet,
		kind: CompletionItemKind.Snippet,
		label: `:is(...)`,
	},
	{
		insertText: `:where($1)`,
		insertTextFormat: InsertTextFormat.Snippet,
		kind: CompletionItemKind.Snippet,
		label: `:where(...)`,
	},
]

export type CssModuleCompletionOptions = {
	offset: number
	renderStory: RenderStory
	sourceText: string
}

function offsetToPosition(sourceText: string, offset: number) {
	let character = 0
	let line = 0

	for (let index = 0; index < offset; index += 1) {
		if (sourceText[index] === `\n`) {
			character = 0
			line += 1
		} else {
			character += 1
		}
	}

	return { character, line }
}

function expectErrorCompletionItem(
	sourceText: string,
	offset: number,
): CompletionItem | undefined {
	const lineStart = sourceText.lastIndexOf(`\n`, offset - 1) + 1
	const linePrefix = sourceText.slice(lineStart, offset)
	const indentationLength = linePrefix.length - linePrefix.trimStart().length
	const typedComment = linePrefix.slice(indentationLength)

	if (
		typedComment.length === 0 ||
		!EXPECT_ERROR_COMMENT_START.startsWith(typedComment)
	) {
		return
	}

	const replacementStart = lineStart + indentationLength

	return {
		filterText: EXPECT_ERROR_COMMENT_START,
		insertTextFormat: InsertTextFormat.Snippet,
		kind: CompletionItemKind.Snippet,
		label: EXPECT_ERROR_DIRECTIVE,
		textEdit: {
			newText: `${EXPECT_ERROR_COMMENT_START}$1 */`,
			range: {
				end: offsetToPosition(sourceText, offset),
				start: offsetToPosition(sourceText, replacementStart),
			},
		},
	}
}

function regionDirectiveCompletionItems(
	sourceText: string,
	offset: number,
): CompletionItem[] {
	const lineStart = sourceText.lastIndexOf(`\n`, offset - 1) + 1
	const linePrefix = sourceText.slice(lineStart, offset)
	const indentationLength = linePrefix.length - linePrefix.trimStart().length
	const typedComment = linePrefix.slice(indentationLength)

	if (typedComment.length === 0) return []

	const replacementStart = lineStart + indentationLength

	return REGION_DIRECTIVE_COMPLETIONS.flatMap(
		({ diagnosticCodePlaceholder, directive }): CompletionItem[] => {
			const commentStart = `/* ${directive} `

			if (!commentStart.startsWith(typedComment)) return []

			return [
				{
					filterText: commentStart,
					insertTextFormat: InsertTextFormat.Snippet,
					kind: CompletionItemKind.Snippet,
					label: directive,
					textEdit: {
						newText: `${commentStart}${diagnosticCodePlaceholder} */`,
						range: {
							end: offsetToPosition(sourceText, offset),
							start: offsetToPosition(sourceText, replacementStart),
						},
					},
				},
			]
		},
	)
}

function isWhitespace(character: string): boolean {
	return /\s/.test(character)
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].toSorted((left, right) =>
		left.localeCompare(right),
	)
}

function walkStoryNodes(children: StoryChild[]): StoryNode[] {
	const nodes: StoryNode[] = []

	for (const child of children) {
		if (child.kind === `choice`) {
			for (const alternative of child.alternatives) {
				nodes.push(...walkStoryNodes(alternative))
			}
			continue
		}
		if (child.kind !== `element`) continue

		nodes.push(child)
		nodes.push(...walkStoryNodes(child.children))
	}

	return nodes
}

function directStoryNodes(children: StoryChild[]): StoryNode[] {
	return children.flatMap((child): StoryNode[] => {
		if (child.kind === `element`) return [child]
		if (child.kind === `choice`) {
			return child.alternatives.flatMap(directStoryNodes)
		}

		return []
	})
}

function rootNodes(renderStory: RenderStory): StoryNode[] {
	return directStoryNodes(renderStory.roots)
}

function allNodes(renderStory: RenderStory): StoryNode[] {
	return walkStoryNodes(renderStory.roots)
}

function allTagNames(renderStory: RenderStory): string[] {
	return uniqueSorted(allNodes(renderStory).map((node) => node.tagName))
}

function rootTagNames(renderStory: RenderStory): string[] {
	return uniqueSorted(rootNodes(renderStory).map((node) => node.tagName))
}

function childNodes(nodes: StoryNode[]): StoryNode[] {
	return nodes.flatMap((node) => directStoryNodes(node.children))
}

function descendantNodes(nodes: StoryNode[]): StoryNode[] {
	return nodes.flatMap((node) => walkStoryNodes(node.children))
}

function matchesPathFromNode(node: StoryNode, path: string[]): StoryNode[] {
	if (path.length === 0) return [node]
	if (node.tagName !== path[0]) return []
	if (path.length === 1) return [node]

	return childNodes([node]).flatMap((child) =>
		matchesPathFromNode(child, path.slice(1)),
	)
}

function nodesForPath(renderStory: RenderStory, path: string[]): StoryNode[] {
	if (path.length === 0) return rootNodes(renderStory)

	return rootNodes(renderStory).flatMap((node) =>
		matchesPathFromNode(node, path),
	)
}

function completionItem(
	label: string,
	kind: CompletionItemKind,
	insertText = label,
): CompletionItem {
	return { insertText, kind, label }
}

function tagCompletionItems(tagNames: string[]): CompletionItem[] {
	return uniqueSorted(tagNames).map((tagName) =>
		completionItem(tagName, CompletionItemKind.Class),
	)
}

function childSelectorCompletionItems(tagNames: string[]): CompletionItem[] {
	return uniqueSorted(tagNames).map((tagName) =>
		completionItem(`> ${tagName}`, CompletionItemKind.Class),
	)
}

function rootSelectorCompletionItems(
	renderStory: RenderStory,
): CompletionItem[] {
	return [
		...rootTagNames(renderStory).map((tagName) =>
			completionItem(`${tagName}.class`, CompletionItemKind.Class),
		),
		completionItem(`.class`, CompletionItemKind.Class),
	]
}

function leadingColonCount(text: string): number {
	let count = 0

	while (text[count] === `:`) {
		count += 1
	}

	return count
}

function trailingColonCount(sourceText: string, offset: number): number {
	let count = 0

	for (let index = offset - 1; sourceText[index] === `:`; index -= 1) {
		count += 1
	}

	return count
}

function reuseTypedColons(
	item: CompletionItem,
	typedColonCount: number,
): CompletionItem {
	if (typedColonCount === 0) return item

	const insertText = item.insertText ?? item.label
	const removeCount = Math.min(typedColonCount, leadingColonCount(insertText))

	if (removeCount === 0) return item

	return { ...item, insertText: insertText.slice(removeCount) }
}

function refinementCompletionItems(typedColonCount: number): CompletionItem[] {
	return [
		...REFINEMENT_COMPLETIONS.map((label) =>
			completionItem(label, CompletionItemKind.Keyword),
		),
		...FUNCTIONAL_REFINEMENT_COMPLETIONS,
		...GLOBAL_COMPLETIONS,
	]
		.filter(
			(item) =>
				typedColonCount < 2 ||
				leadingColonCount(item.insertText ?? item.label) >= typedColonCount,
		)
		.map((item) => reuseTypedColons(item, typedColonCount))
}

function splitSelectorList(selector: string): string[] {
	const selectors: string[] = []
	let partStart = 0
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined

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
			const text = selector.slice(partStart, index).trim()

			if (text.length > 0) selectors.push(text)

			partStart = index + 1
		}
	}

	return selectors
}

function combineSelectors(
	parentSelector: string,
	nestedSelector: string,
): string {
	const parent = parentSelector.trim()
	const nested = nestedSelector.trim()

	if (!parent) return nested
	if (!nested) return parent
	if (nested.includes(`&`)) return nested.replaceAll(`&`, parent)
	if (nested.startsWith(`>`)) return `${parent} ${nested}`

	return `${parent} ${nested}`
}

function currentSelectorListItem(
	selector: string,
	options: { preserveTrailingWhitespace?: boolean } = {},
): string {
	let partStart = 0
	let parenDepth = 0
	let bracketDepth = 0
	let quote: `"` | `'` | undefined

	for (let index = 0; index < selector.length; index += 1) {
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

		if (character === `,` && parenDepth === 0 && bracketDepth === 0) {
			partStart = index + 1
		}
	}

	const text = selector.slice(partStart)

	return options.preserveTrailingWhitespace ? text.trimStart() : text.trim()
}

function selectorContextsBeforeOffset(
	sourceText: string,
	offset: number,
): string[] {
	const stack: Array<string | null> = []
	let preludeStart = 0
	let quote: `"` | `'` | undefined

	for (let index = 0; index < offset; index += 1) {
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

			if (commentEnd === -1 || commentEnd >= offset) return []

			index = commentEnd + 1
			continue
		}

		if (character === `{`) {
			const selector = sourceText.slice(preludeStart, index).trim()
			stack.push(selector.startsWith(`@`) ? null : selector)
			preludeStart = index + 1
			continue
		}

		if (character === `}`) {
			stack.pop()
			preludeStart = index + 1
			continue
		}

		if (character === `;`) {
			preludeStart = index + 1
		}
	}

	let selectors = [``]

	for (const selector of stack) {
		if (selector === null) continue

		selectors = selectors.flatMap((parentSelector) =>
			splitSelectorList(selector).map((nestedSelector) =>
				combineSelectors(parentSelector, nestedSelector),
			),
		)
	}

	const currentSelector = currentSelectorListItem(
		sourceText.slice(preludeStart, offset),
		{ preserveTrailingWhitespace: true },
	)

	if (!currentSelector.trim()) return selectors

	const hasTrailingWhitespace = /\s$/.test(currentSelector)

	return selectors.map((parentSelector) => {
		const combinedSelector = combineSelectors(parentSelector, currentSelector)

		return hasTrailingWhitespace ? `${combinedSelector} ` : combinedSelector
	})
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

function readIdentifier(text: string, start: number): string {
	let end = start

	while (end < text.length && /[-_a-zA-Z0-9]/.test(text[end] ?? ``)) {
		end += 1
	}

	return text.slice(start, end)
}

function getCompoundTagName(compound: string): string | undefined {
	const stripped = stripBalancedSections(compound, {
		brackets: true,
		parentheses: true,
	}).trim()

	if (stripped.startsWith(`*`)) return
	if (!/^[-_a-zA-Z]/.test(stripped)) return

	const tagName = readIdentifier(stripped, 0)

	return tagName.length > 0 ? tagName : undefined
}

function tokenizeSelectorTags(selector: string): string[] {
	const tags: string[] = []
	let compound = ``
	let parenDepth = 0
	let bracketDepth = 0

	function pushCompound(): void {
		const tagName = getCompoundTagName(compound)

		if (tagName) tags.push(tagName)

		compound = ``
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

		if (character === `>` || isWhitespace(character)) {
			pushCompound()
			continue
		}

		compound += character
	}

	pushCompound()

	return tags
}

function selectorPathContext(selector: string): SelectorPathContext {
	const trimmed = selector.trim()

	if (!trimmed) return { path: [], relation: `root` }
	if (trimmed.endsWith(`>`)) {
		return {
			path: tokenizeSelectorTags(trimmed.slice(0, -1)),
			relation: `child`,
		}
	}
	if (/\s$/.test(selector)) {
		return {
			path: tokenizeSelectorTags(trimmed),
			relation: `descendant`,
		}
	}

	return { path: tokenizeSelectorTags(trimmed), relation: `self` }
}

function attributeCompletionContext(
	sourceText: string,
	offset: number,
): CompletionContext | undefined {
	const prefix = sourceText.slice(0, offset)
	const openBracketIndex = prefix.lastIndexOf(`[`)
	const closeBracketIndex = prefix.lastIndexOf(`]`)

	if (openBracketIndex === -1 || closeBracketIndex > openBracketIndex) return

	const attributeText = prefix.slice(openBracketIndex + 1)
	const equalsIndex = attributeText.indexOf(`=`)
	const selectors = selectorContextsBeforeOffset(sourceText, openBracketIndex)
	const tagNames = uniqueSorted(
		selectors.flatMap(
			(selector) => tokenizeSelectorTags(selector).at(-1) ?? [],
		),
	)

	if (equalsIndex === -1) return { kind: `attribute-name`, tagNames }

	const attributeName = attributeText.slice(0, equalsIndex).trim()

	if (!attributeName) return { kind: `attribute-name`, tagNames }

	return { attributeName, kind: `attribute-value`, tagNames }
}

function completionContext(
	sourceText: string,
	offset: number,
): CompletionContext {
	return (
		attributeCompletionContext(sourceText, offset) ?? {
			kind: `selector`,
			selectorTexts: selectorContextsBeforeOffset(sourceText, offset),
		}
	)
}

function nodesForTagNames(
	renderStory: RenderStory,
	tagNames: string[],
): StoryNode[] {
	if (tagNames.length === 0) return allNodes(renderStory)

	const allowedTagNames = new Set(tagNames)

	return allNodes(renderStory).filter((node) =>
		allowedTagNames.has(node.tagName),
	)
}

function attributeNameItems(
	renderStory: RenderStory,
	tagNames: string[],
): CompletionItem[] {
	const names = uniqueSorted(
		nodesForTagNames(renderStory, tagNames).flatMap((node) =>
			(node.attributes ?? [])
				.map((attribute) => attribute.name)
				.filter((name) => name !== MODULE_CLASS_NAME),
		),
	)

	return names.map((name) => completionItem(name, CompletionItemKind.Property))
}

function attributeValueItems(
	renderStory: RenderStory,
	tagNames: string[],
	attributeName: string,
): CompletionItem[] {
	const values = uniqueSorted(
		nodesForTagNames(renderStory, tagNames).flatMap((node) =>
			(node.attributes ?? [])
				.filter(
					(attribute): attribute is StoryAttribute & { value: string } =>
						attribute.name === attributeName && attribute.value !== undefined,
				)
				.map((attribute) => attribute.value),
		),
	)

	return values.map((value) => completionItem(value, CompletionItemKind.Value))
}

function selectorTagItems(
	renderStory: RenderStory,
	context: SelectorPathContext,
): CompletionItem[] {
	if (context.relation === `root`) {
		return [
			...rootSelectorCompletionItems(renderStory),
			...tagCompletionItems(rootTagNames(renderStory)),
		]
	}

	const contextNodes = nodesForPath(renderStory, context.path)

	if (context.relation === `child`) {
		return tagCompletionItems(
			childNodes(contextNodes).map((node) => node.tagName),
		)
	}

	if (context.relation === `descendant`) {
		return tagCompletionItems(
			descendantNodes(contextNodes).map((node) => node.tagName),
		)
	}

	if (context.path.length === 0) {
		return childSelectorCompletionItems(
			rootNodes(renderStory).flatMap((node) =>
				childNodes([node]).map((child) => child.tagName),
			),
		)
	}

	return tagCompletionItems(allTagNames(renderStory))
}

function selectorItems(
	renderStory: RenderStory,
	selectorTexts: string[],
	typedColonCount: number,
): CompletionItem[] {
	const selectorContexts = selectorTexts.map(selectorPathContext)
	const tagItems =
		selectorContexts.length === 0
			? tagCompletionItems(allTagNames(renderStory))
			: selectorContexts.flatMap((context) =>
					selectorTagItems(renderStory, context),
				)

	return uniqueCompletionItems([
		...tagItems,
		...refinementCompletionItems(typedColonCount),
	])
}

function uniqueCompletionItems(items: CompletionItem[]): CompletionItem[] {
	const byLabel = new Map<string, CompletionItem>()

	for (const item of items) {
		if (!byLabel.has(item.label)) byLabel.set(item.label, item)
	}

	return [...byLabel.values()].toSorted((left, right) =>
		left.label.localeCompare(right.label),
	)
}

export function createCssModuleCompletionItems({
	offset,
	renderStory,
	sourceText,
}: CssModuleCompletionOptions): CompletionItem[] {
	const expectErrorItem = expectErrorCompletionItem(sourceText, offset)
	const regionDirectiveItems = regionDirectiveCompletionItems(
		sourceText,
		offset,
	)
	const directiveItems = [
		...(expectErrorItem ? [expectErrorItem] : []),
		...regionDirectiveItems,
	]

	if (directiveItems.length > 0) return uniqueCompletionItems(directiveItems)

	const context = completionContext(sourceText, offset)

	switch (context.kind) {
		case `attribute-name`:
			return attributeNameItems(renderStory, context.tagNames)
		case `attribute-value`:
			return attributeValueItems(
				renderStory,
				context.tagNames,
				context.attributeName,
			)
		case `selector`:
			return selectorItems(
				renderStory,
				context.selectorTexts,
				trailingColonCount(sourceText, offset),
			)
	}
}
