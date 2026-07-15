import type {
	Reachability,
	RenderStory,
	SelectorPath,
	SelectorPathSegment,
	StoryChild,
	StoryNode,
} from "./diagnostics.ts"

function combineReachability(results: Reachability[]): Reachability {
	if (results.includes(`reachable`)) return `reachable`
	if (results.includes(`unknown`)) return `unknown`
	return `unreachable`
}

function segmentMatches(
	node: StoryNode,
	segment: SelectorPathSegment,
): boolean {
	return node.tagName === segment.tagName
}

function canReachFromNode(
	node: StoryNode,
	path: SelectorPath,
	segmentIndex: number,
): Reachability {
	if (segmentIndex >= path.length) return `reachable`

	const segment = path[segmentIndex]

	if (!segment) return `reachable`

	if (segment.relation === `child`) {
		return canReachDirectChild(node, path, segmentIndex)
	}

	if (segment.relation === `descendant`) {
		return canReachDescendant(node, path, segmentIndex)
	}

	return `unreachable`
}

function canReachDirectChild(
	node: StoryNode,
	path: SelectorPath,
	segmentIndex: number,
): Reachability {
	return canReachDirectChildFromChildren(node.children, path, segmentIndex)
}

function canReachDirectChildFromChildren(
	children: StoryChild[],
	path: SelectorPath,
	segmentIndex: number,
): Reachability {
	const segment = path[segmentIndex]

	if (!segment) return `reachable`

	const results = children.map((child): Reachability => {
		if (child.kind === `opaque`) return `unknown`
		if (child.kind === `choice`) {
			return combineReachability(
				child.alternatives.map((alternative) =>
					canReachDirectChildFromChildren(alternative, path, segmentIndex),
				),
			)
		}
		if (!segmentMatches(child, segment)) return `unreachable`

		return canReachFromNode(child, path, segmentIndex + 1)
	})

	return combineReachability(results)
}

function canReachDescendant(
	node: StoryNode,
	path: SelectorPath,
	segmentIndex: number,
): Reachability {
	return canReachDescendantFromChildren(node.children, path, segmentIndex)
}

function canReachDescendantFromChildren(
	children: StoryChild[],
	path: SelectorPath,
	segmentIndex: number,
): Reachability {
	const segment = path[segmentIndex]

	if (!segment) return `reachable`

	const results = children.map((child): Reachability => {
		if (child.kind === `opaque`) return `unknown`
		if (child.kind === `choice`) {
			return combineReachability(
				child.alternatives.map((alternative) =>
					canReachDescendantFromChildren(alternative, path, segmentIndex),
				),
			)
		}

		const fromChild = segmentMatches(child, segment)
			? canReachFromNode(child, path, segmentIndex + 1)
			: `unreachable`
		const fromDescendant = canReachDescendant(child, path, segmentIndex)

		return combineReachability([fromChild, fromDescendant])
	})

	return combineReachability(results)
}

function canReachFromRoot(root: StoryChild, path: SelectorPath): Reachability {
	if (root.kind === `opaque`) return `unknown`
	if (root.kind === `choice`) {
		return combineReachability(
			root.alternatives.flatMap((alternative) =>
				alternative.map((child) => canReachFromRoot(child, path)),
			),
		)
	}

	const rootSegment = path[0]

	if (!rootSegment) return `unknown`

	if (!segmentMatches(root, rootSegment)) return `unreachable`

	return canReachFromNode(root, path, 1)
}

export function canReachSelectorPath(
	story: RenderStory,
	path: SelectorPath,
): Reachability {
	if (path.length === 0) return `unknown`

	return combineReachability(
		story.roots.map((root) => canReachFromRoot(root, path)),
	)
}
