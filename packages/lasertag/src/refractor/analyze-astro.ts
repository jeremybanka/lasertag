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

export type AnalyzeAstroOptions = {
	sourceText: string
	filePath?: string
	componentName?: string
}

function opaque(reason: string): OpaqueStoryNode {
	return {
		kind: `opaque`,
		reason,
	}
}

function storyAttribute(attribute: AttributeNode): StoryAttribute {
	return {
		name: attribute.name,
		...(attribute.kind === `quoted` ? { value: attribute.value } : {}),
	}
}

function storyElement(
	node: Extract<AstroNode, { type: `element` | `custom-element` }>,
): StoryNode {
	const children = node.children.flatMap(analyzeNode)
	const attributes = node.attributes.map(storyAttribute)
	const hasInjectedHtml = node.attributes.some(
		(attribute) => attribute.name === `set:html`,
	)

	return {
		children: hasInjectedHtml
			? [...children, opaque(`set:html render branch`)]
			: children,
		kind: `element`,
		tagName: node.name,
		...(attributes.length > 0 ? { attributes } : {}),
	}
}

function analyzeExpression(
	node: Extract<AstroNode, { type: `expression` }>,
): StoryChild[] {
	const children = node.children.flatMap((child) =>
		child.type === `text` ? [] : analyzeNode(child),
	)

	return children.length > 0
		? children
		: [opaque(`unknown Astro expression render branch`)]
}

function analyzeSlot(
	node: Extract<AstroNode, { type: `element` }>,
): StoryChild[] {
	return [...node.children.flatMap(analyzeNode), opaque(`slot render branch`)]
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
			return [opaque(`imported or external Astro component`)]
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

	return {
		componentName: componentNameFromOptions(options),
		roots: result.ast.children.flatMap(analyzeNode),
		warnings: [],
	}
}
