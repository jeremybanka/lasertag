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
	return segment.tagName === `*` || node.tagName === segment.tagName
}

function opaqueBoundaryCanMatch(
	node: Extract<StoryChild, { kind: `opaque` }>,
	segment: SelectorPathSegment,
): boolean {
	if (node.ownership !== `foreign`) return false

	return (
		node.expectedRootTagName === undefined ||
		segment.tagName === `*` ||
		node.expectedRootTagName === segment.tagName
	)
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

export type OwnershipBoundaryEvidence =
	| {
			componentName: string
			kind: `foreign-component-descendant`
			rootTagName: string
			rootWasAsserted: boolean
			segmentIndex: number
	  }
	| {
			componentName: string
			kind: `foreign-component-root`
			rootTagName: string
			segmentIndex: number
	  }
	| {
			componentName: string
			kind: `opaque-component-root`
			rootTagName: string
			segmentIndex: number
	  }
	| {
			kind: `ownership-boundary`
			segmentIndex: number
	  }

function uniqueOwnershipEvidence(
	evidence: OwnershipBoundaryEvidence[],
): OwnershipBoundaryEvidence[] {
	const seen = new Set<string>()

	return evidence.filter((item) => {
		const key = JSON.stringify(item)

		if (seen.has(key)) return false

		seen.add(key)
		return true
	})
}

function ownershipEvidenceFromNode(
	node: StoryNode,
	path: SelectorPath,
	segmentIndex: number,
): OwnershipBoundaryEvidence[] {
	if (segmentIndex >= path.length) return []

	const segment = path[segmentIndex]

	if (!segment) return []

	return segment.relation === `child`
		? ownershipEvidenceFromDirectChildren(node.children, path, segmentIndex)
		: segment.relation === `descendant`
			? ownershipEvidenceFromDescendants(node.children, path, segmentIndex)
			: []
}

function ownershipEvidenceFromOpaque(
	child: Extract<StoryChild, { kind: `opaque` }>,
	segment: SelectorPathSegment,
	segmentIndex: number,
): OwnershipBoundaryEvidence[] {
	if (!opaqueBoundaryCanMatch(child, segment)) return []

	return child.componentName && child.expectedRootTagName === undefined
		? [
				{
					componentName: child.componentName,
					kind: `opaque-component-root`,
					rootTagName: segment.tagName,
					segmentIndex,
				},
			]
		: [{ kind: `ownership-boundary`, segmentIndex }]
}

function ownershipEvidenceFromForeignRoot(
	child: StoryNode,
	path: SelectorPath,
	segmentIndex: number,
): OwnershipBoundaryEvidence[] {
	if (segmentIndex + 1 < path.length) {
		return child.componentName
			? [
					{
						componentName: child.componentName,
						kind: `foreign-component-descendant`,
						rootTagName: child.tagName,
						rootWasAsserted: child.addressable === true,
						segmentIndex,
					},
				]
			: [{ kind: `ownership-boundary`, segmentIndex }]
	}

	if (child.addressable) return []

	return child.componentName
		? [
				{
					componentName: child.componentName,
					kind: `foreign-component-root`,
					rootTagName: child.tagName,
					segmentIndex,
				},
			]
		: [{ kind: `ownership-boundary`, segmentIndex }]
}

function ownershipEvidenceFromDirectChildren(
	children: StoryChild[],
	path: SelectorPath,
	segmentIndex: number,
): OwnershipBoundaryEvidence[] {
	const segment = path[segmentIndex]

	if (!segment) return []

	return uniqueOwnershipEvidence(
		children.flatMap((child) => {
			if (child.kind === `opaque`) {
				return ownershipEvidenceFromOpaque(child, segment, segmentIndex)
			}

			if (child.kind === `choice`) {
				return child.alternatives.flatMap((alternative) =>
					ownershipEvidenceFromDirectChildren(alternative, path, segmentIndex),
				)
			}

			if (!segmentMatches(child, segment)) return []
			if (child.ownership === `foreign`) {
				return ownershipEvidenceFromForeignRoot(child, path, segmentIndex)
			}

			return ownershipEvidenceFromNode(child, path, segmentIndex + 1)
		}),
	)
}

function ownershipEvidenceFromDescendants(
	children: StoryChild[],
	path: SelectorPath,
	segmentIndex: number,
): OwnershipBoundaryEvidence[] {
	const segment = path[segmentIndex]

	if (!segment) return []

	return uniqueOwnershipEvidence(
		children.flatMap((child) => {
			if (child.kind === `opaque`) {
				return ownershipEvidenceFromOpaque(child, segment, segmentIndex)
			}
			if (child.kind === `choice`) {
				return child.alternatives.flatMap((alternative) =>
					ownershipEvidenceFromDescendants(alternative, path, segmentIndex),
				)
			}
			if (child.ownership === `foreign`) {
				if (segmentMatches(child, segment) && !child.addressable) {
					return ownershipEvidenceFromForeignRoot(child, path, segmentIndex)
				}

				return child.componentName
					? [
							{
								componentName: child.componentName,
								kind: `foreign-component-descendant`,
								rootTagName: child.tagName,
								rootWasAsserted: child.addressable === true,
								segmentIndex,
							},
						]
					: [{ kind: `ownership-boundary`, segmentIndex }]
			}

			const throughMatch =
				segmentMatches(child, segment) &&
				ownershipEvidenceFromNode(child, path, segmentIndex + 1)
			const throughDescendant = ownershipEvidenceFromDescendants(
				child.children,
				path,
				segmentIndex,
			)

			return [...(throughMatch || []), ...throughDescendant]
		}),
	)
}

function ownershipEvidenceFromRoot(
	root: StoryChild,
	path: SelectorPath,
): OwnershipBoundaryEvidence[] {
	if (root.kind === `opaque`) return []
	if (root.kind === `choice`) {
		return uniqueOwnershipEvidence(
			root.alternatives.flatMap((alternative) =>
				alternative.flatMap((child) => ownershipEvidenceFromRoot(child, path)),
			),
		)
	}

	const rootSegment = path[0]

	if (!rootSegment || !segmentMatches(root, rootSegment)) return []
	if (path.length < 2) return []
	if (root.ownership === `foreign`) {
		return ownershipEvidenceFromForeignRoot(root, path, 0)
	}

	return ownershipEvidenceFromNode(root, path, 1)
}

export function findOwnershipBoundaryEvidence(
	story: RenderStory,
	path: SelectorPath,
): OwnershipBoundaryEvidence[] {
	if (path.length < 2) return []

	return uniqueOwnershipEvidence(
		story.roots.flatMap((root) => ownershipEvidenceFromRoot(root, path)),
	)
}

export function canCrossOwnershipBoundary(
	story: RenderStory,
	path: SelectorPath,
): boolean {
	return findOwnershipBoundaryEvidence(story, path).length > 0
}
