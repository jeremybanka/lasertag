import type {
	RenderStory,
	StoryAttribute,
	StoryChild,
	StoryNode,
} from "./diagnostics.ts"

export type CssClassRenderRootOptions = {
	bindingName?: string
	exportName?: string
	missingAttachment?: `opaque` | `preserve`
}

const DEFAULT_CSS_MODULE_BINDING = `css`
const DEFAULT_CSS_MODULE_EXPORT = `class`

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}

function expressionUsesCssModuleClass(
	expression: string,
	options: CssClassRenderRootOptions,
): boolean {
	const bindingName = escapeRegExp(
		options.bindingName ?? DEFAULT_CSS_MODULE_BINDING,
	)
	const exportName = escapeRegExp(
		options.exportName ?? DEFAULT_CSS_MODULE_EXPORT,
	)
	const memberAccess = String.raw`${bindingName}\s*(?:\.|\?\.)\s*${exportName}`
	const bracketAccess = String.raw`${bindingName}\s*\[\s*["']${exportName}["']\s*\]`
	const pattern = new RegExp(
		String.raw`(?:^|[^\w$.])(?:${memberAccess}|${bracketAccess})(?![\w$])`,
	)

	return pattern.test(expression)
}

function isClassAttribute(attribute: StoryAttribute): boolean {
	return attribute.name === `class` || attribute.name === `class:list`
}

export function hasCssClassAttachment(
	node: StoryNode,
	options: CssClassRenderRootOptions = {},
): boolean {
	return (
		node.attributes?.some(
			(attribute) =>
				isClassAttribute(attribute) &&
				attribute.expression !== undefined &&
				expressionUsesCssModuleClass(attribute.expression, options),
		) === true
	)
}

export function findCssClassRenderRoots(
	children: readonly StoryChild[],
	options: CssClassRenderRootOptions = {},
): StoryNode[] {
	const roots: StoryNode[] = []

	for (const child of children) {
		if (child.kind === `opaque`) continue
		if (child.kind === `choice`) {
			for (const alternative of child.alternatives) {
				roots.push(...findCssClassRenderRoots(alternative, options))
			}
			continue
		}

		if (hasCssClassAttachment(child, options)) {
			roots.push(child)
			continue
		}

		roots.push(...findCssClassRenderRoots(child.children, options))
	}

	return roots
}

function scopedCssClassRenderRoots(
	children: readonly StoryChild[],
	options: CssClassRenderRootOptions,
): StoryChild[] {
	return children.flatMap((child): StoryChild[] => {
		if (child.kind === `opaque`) return []
		if (child.kind === `choice`) {
			const alternatives = child.alternatives.map((alternative) =>
				scopedCssClassRenderRoots(alternative, options),
			)

			return alternatives.some((alternative) => alternative.length > 0)
				? [{ ...child, alternatives }]
				: []
		}
		if (hasCssClassAttachment(child, options)) return [child]

		return scopedCssClassRenderRoots(child.children, options)
	})
}

export function scopeRenderStoryToCssClassRoots(
	renderStory: RenderStory,
	options: CssClassRenderRootOptions = {},
): RenderStory {
	const roots = scopedCssClassRenderRoots(renderStory.roots, options)

	if (roots.length > 0) return { ...renderStory, roots }
	if (options.missingAttachment !== `opaque`) return renderStory

	return {
		...renderStory,
		roots: [
			{
				kind: `opaque`,
				reason: `CSS Module class attachment not found`,
			},
		],
	}
}
