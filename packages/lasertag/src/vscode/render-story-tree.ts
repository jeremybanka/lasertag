import type {
	LasertagRenderStoryView,
	RenderStoryViewLocation,
	RenderStoryViewNode,
	RenderStoryViewUnreachableStyle,
} from "../lsp/render-story-view.ts"

export const LASERTAG_RENDER_STORY_VIEW_ID = `lasertag.renderStory`
export const LASERTAG_OPEN_STYLES_COMMAND = `lasertag.openStyles`
export const LASERTAG_OPEN_RENDER_SOURCE_COMMAND = `lasertag.openRenderSource`
export const LASERTAG_OPEN_STORY_LOCATION_COMMAND = `lasertag.openStoryLocation`
export const LASERTAG_IN_CONTEXT_KEY = `lasertag.inContext`

export type RenderStoryTreeDecoration = `supported` | `unreachable`

export type RenderStoryTreeEntry = {
	children: RenderStoryTreeEntry[]
	decoration?: RenderStoryTreeDecoration
	description?: string
	icon?: `info` | `question` | `warning`
	label: string
	location?: RenderStoryViewLocation
	tooltip?: string
}

function renderNode(node: RenderStoryViewNode): RenderStoryTreeEntry {
	return {
		children: node.children.map(renderNode),
		...(node.support === `supported`
			? { decoration: `supported` as const }
			: {}),
		...(node.kind === `opaque` ? { icon: `question` as const } : {}),
		label: node.label,
		...(node.location ? { location: node.location } : {}),
		...(node.tooltip ? { tooltip: node.tooltip } : {}),
	}
}

function relationLabel(
	style: RenderStoryViewUnreachableStyle,
	index: number,
): string {
	const segment = style.path[index]

	if (!segment) return `unknown selector step`

	const relation = index === 0 || segment.relation !== `descendant` ? `` : `… `
	const expected = index === style.path.length - 1 && style.expected ? ` *` : ``

	return `${relation}${segment.tagName}${expected}`
}

function unreachableStyleTree(
	style: RenderStoryViewUnreachableStyle,
): RenderStoryTreeEntry {
	let child: RenderStoryTreeEntry | undefined

	for (let index = style.path.length - 1; index >= 0; index -= 1) {
		const terminal = index === style.path.length - 1
		const entry: RenderStoryTreeEntry = {
			children: child ? [child] : [],
			...(terminal && !style.expected
				? { decoration: `unreachable` as const }
				: {}),
			label: relationLabel(style, index),
			...(terminal ? { location: style.location } : {}),
			...(terminal
				? {
						tooltip: style.expected
							? `${style.selector}\n* Expected with @lasertag-expect-error`
							: `${style.selector}\nStyled, but unreachable in every render story`,
					}
				: {}),
		}

		child = entry
	}

	return (
		child ?? {
			children: [],
			label: style.selector,
			location: style.location,
		}
	)
}

export function createRenderStoryTree(
	view: LasertagRenderStoryView,
): RenderStoryTreeEntry[] {
	if (view.kind === `outside-context`) return []
	if (view.kind === `unavailable`) {
		return [
			{
				children: [],
				icon: `info`,
				label: view.message,
				...((view.sourceLocation ?? view.cssLocation)
					? { location: view.sourceLocation ?? view.cssLocation }
					: {}),
				tooltip: view.message,
			},
		]
	}

	const entries = view.possibilities.map(
		(possibility, index): RenderStoryTreeEntry => ({
			children: possibility.roots.map(renderNode),
			...(index === 0 ? { description: view.componentName } : {}),
			label: `Possibility ${index + 1}`,
		}),
	)

	if (view.truncated) {
		entries.push({
			children: [],
			icon: `info`,
			label: `More possibilities omitted`,
			tooltip: `The sidebar shows the first 48 materialized render stories.`,
		})
	}

	if (view.unreachableStyles.length > 0) {
		const warningCount = view.unreachableStyles.filter(
			(style) => !style.expected,
		).length

		entries.push({
			children: view.unreachableStyles.map(unreachableStyleTree),
			...(warningCount > 0 ? { icon: `warning` as const } : {}),
			description: `${view.unreachableStyles.length}`,
			label: `Unreachable styles`,
			tooltip:
				warningCount > 0
					? `${warningCount} styled selector${warningCount === 1 ? `` : `s`} cannot occur in any render story.`
					: `All unreachable styles shown here are expected (*).`,
		})
	}

	return entries
}
