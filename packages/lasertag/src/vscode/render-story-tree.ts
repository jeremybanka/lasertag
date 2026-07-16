import type {
	LasertagRenderStoryView,
	RenderStoryViewLocation,
	RenderStoryViewNode,
} from "../lsp/render-story-view.ts"

export const LASERTAG_RENDER_STORY_VIEW_ID = `lasertag.renderStory`
export const LASERTAG_OPEN_STYLES_COMMAND = `lasertag.openStyles`
export const LASERTAG_OPEN_RENDER_SOURCE_COMMAND = `lasertag.openRenderSource`
export const LASERTAG_OPEN_STORY_LOCATION_COMMAND = `lasertag.openStoryLocation`
export const LASERTAG_IN_CONTEXT_KEY = `lasertag.inContext`

export type RenderStoryTreeDecoration =
	| `regular`
	| `unreachable`
	| `unsupported`

export type RenderStoryTreeEntry = {
	children: RenderStoryTreeEntry[]
	decoration?: RenderStoryTreeDecoration
	description?: string
	expanded?: boolean
	icon?: `circle-slash` | `info` | `list-tree` | `pass` | `question` | `warning`
	label: string
	location?: RenderStoryViewLocation
	tooltip?: string
}

function renderNode(node: RenderStoryViewNode): RenderStoryTreeEntry {
	const decoration =
		node.support === `none`
			? `unsupported`
			: node.support === `unreachable`
				? `unreachable`
				: `regular`
	const icon =
		node.kind === `opaque`
			? `question`
			: node.support === `none`
				? `circle-slash`
				: node.support === `unreachable`
					? `warning`
					: node.support === `expected-unreachable`
						? `info`
						: `pass`

	return {
		children: node.children.map(renderNode),
		decoration,
		...(node.expectErrorExplanation === undefined
			? {}
			: { description: node.expectErrorExplanation }),
		...(node.children.length > 0 ? { expanded: true } : {}),
		icon,
		label: node.label,
		...(node.location ? { location: node.location } : {}),
		...(node.tooltip ? { tooltip: node.tooltip } : {}),
	}
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
			decoration: `regular`,
			...(index === 0 ? { description: view.componentName } : {}),
			expanded: true,
			icon: `list-tree`,
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

	return entries
}
