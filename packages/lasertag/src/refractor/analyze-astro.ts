import path from "node:path"

import { parse } from "@astrojs/compiler/sync"
import type { AttributeNode, Node as AstroNode } from "@astrojs/compiler/types"

import type {
	OpaqueStoryNode,
	RenderStory,
	StoryAttribute,
	StoryChild,
	StoryNode,
} from "./diagnostics.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"

export type AnalyzeAstroOptions = {
	sourceText: string
	filePath?: string
	componentName?: string
	scopeToCssClassRoots?: boolean
}

const STRING_LITERAL_EXPRESSION =
	/^(?:"(?:[^"\\\r\n]|\\[\s\S])*"|'(?:[^'\\\r\n]|\\[\s\S])*')$/
const DECIMAL_NUMBER_EXPRESSION =
	/^[+-]?(?:(?:[0-9](?:_?[0-9])*)(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.(?:[0-9](?:_?[0-9])*))(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/
const RADIX_NUMBER_EXPRESSION =
	/^[+-]?0(?:[bB][01](?:_?[01])*|[oO][0-7](?:_?[0-7])*|[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*)$/
const BIGINT_EXPRESSION =
	/^[+-]?(?:[0-9](?:_?[0-9])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*)n$/
const PRIMITIVE_KEYWORD_EXPRESSIONS = new Set([
	`false`,
	`null`,
	`true`,
	`undefined`,
])

function foreignOpaque(reason: string): OpaqueStoryNode {
	return {
		kind: `opaque`,
		ownership: `foreign`,
		reason,
	}
}

function storyAttribute(attribute: AttributeNode): StoryAttribute {
	return {
		name: attribute.name,
		...(attribute.kind === `quoted` ? { value: attribute.value } : {}),
		...(attribute.kind === `expression` || attribute.kind === `template-literal`
			? { expression: attribute.value }
			: {}),
	}
}

function toKebabCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, `$1-$2`)
		.replace(/([A-Z])([A-Z][a-z])/g, `$1-$2`)
		.toLowerCase()
}

function storyAttributes(attributes: AttributeNode[]): StoryAttribute[] {
	return attributes.map(storyAttribute)
}

function storyElement(
	node: Extract<AstroNode, { type: `element` | `custom-element` }>,
): StoryNode {
	const children = node.children.flatMap(analyzeNode)
	const attributes = storyAttributes(node.attributes)
	const hasInjectedHtml = node.attributes.some(
		(attribute) => attribute.name === `set:html`,
	)

	return {
		children: hasInjectedHtml
			? [...children, foreignOpaque(`set:html render branch`)]
			: children,
		kind: `element`,
		tagName: node.name,
		...(attributes.length > 0 ? { attributes } : {}),
	}
}

function isLayoutComponent(name: string): boolean {
	return name.endsWith(`Layout`)
}

function analyzeComponent(
	node: Extract<AstroNode, { type: `component` }>,
): StoryChild[] {
	if (isLayoutComponent(node.name)) {
		return node.children.flatMap(analyzeNode)
	}

	if (!/^[A-Z][A-Za-z0-9]*$/.test(node.name)) {
		return [foreignOpaque(`dynamic Astro component`)]
	}

	const attributes = storyAttributes(node.attributes)

	return [
		{
			children: [
				foreignOpaque(`Astro component "${node.name}" implementation`),
			],
			kind: `element`,
			ownership: `foreign`,
			tagName: toKebabCase(node.name),
			...(attributes.length > 0 ? { attributes } : {}),
		},
	]
}

function analyzeExpression(
	node: Extract<AstroNode, { type: `expression` }>,
): StoryChild[] {
	const children = node.children.flatMap((child) =>
		child.type === `text` ? [] : analyzeNode(child),
	)

	if (children.length > 0) return children
	if (isPrimitiveExpression(node)) return []

	return [foreignOpaque(`unknown Astro expression render branch`)]
}

function isPrimitiveExpression(
	node: Extract<AstroNode, { type: `expression` }>,
): boolean {
	if (node.children.some((child) => child.type !== `text`)) return false

	const expression = node.children
		.map((child) => (child.type === `text` ? child.value : ``))
		.join(``)
		.trim()

	return (
		PRIMITIVE_KEYWORD_EXPRESSIONS.has(expression) ||
		STRING_LITERAL_EXPRESSION.test(expression) ||
		DECIMAL_NUMBER_EXPRESSION.test(expression) ||
		RADIX_NUMBER_EXPRESSION.test(expression) ||
		BIGINT_EXPRESSION.test(expression)
	)
}

function analyzeSlot(
	node: Extract<AstroNode, { type: `element` }>,
): StoryChild[] {
	return [
		...node.children.flatMap(analyzeNode),
		foreignOpaque(`slot render branch`),
	]
}

function analyzeNode(node: AstroNode): StoryChild[] {
	switch (node.type) {
		case `root`:
		case `fragment`:
			return node.children.flatMap(analyzeNode)
		case `element`:
			return node.name === `slot` ? analyzeSlot(node) : [storyElement(node)]
		case `custom-element`:
			return [storyElement(node)]
		case `component`:
			return analyzeComponent(node)
		case `expression`:
			return analyzeExpression(node)
		case `comment`:
		case `doctype`:
		case `frontmatter`:
		case `text`:
			return []
	}
}

function componentNameFromOptions(options: AnalyzeAstroOptions): string {
	if (options.componentName) return options.componentName
	if (!options.filePath) return `component`

	return path.basename(options.filePath, path.extname(options.filePath))
}

export function analyzeAstroRenderStory(
	options: AnalyzeAstroOptions,
): RenderStory {
	const result = parse(options.sourceText, { position: true })
	const errors = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === 1,
	)

	if (errors.length > 0) {
		const detail = errors
			.map(
				(diagnostic) =>
					`${diagnostic.text} (${diagnostic.location.line}:${diagnostic.location.column})`,
			)
			.join(`; `)

		throw new Error(`Could not parse Astro render story: ${detail}`)
	}

	const renderStory = {
		componentName: componentNameFromOptions(options),
		roots: result.ast.children.flatMap(analyzeNode),
		warnings: [],
	}

	return options.scopeToCssClassRoots === false
		? renderStory
		: scopeRenderStoryToCssClassRoots(renderStory)
}
