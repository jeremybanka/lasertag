import type { StoryChild } from "./diagnostics.ts"

function structuralChildValue(child: StoryChild): unknown {
	if (child.kind === `opaque`) {
		return { kind: child.kind, reason: child.reason }
	}

	if (child.kind === `choice`) {
		return {
			alternatives: child.alternatives.map(structuralChildrenValue),
			kind: child.kind,
		}
	}

	return {
		children: structuralChildrenValue(child.children),
		kind: child.kind,
		tagName: child.tagName,
	}
}

function structuralChildrenValue(children: StoryChild[]): unknown[] {
	return children.map(structuralChildValue)
}

function structuralChildrenKey(children: StoryChild[]): string {
	return JSON.stringify(structuralChildrenValue(children))
}

function collapseEquivalentChildren(children: StoryChild[]): StoryChild[] {
	const collapsed: StoryChild[] = []
	const seen = new Set<string>()

	for (const child of children) {
		const normalized =
			child.kind === `element`
				? {
						...child,
						children: collapseEquivalentChildren(child.children),
					}
				: child
		const key = JSON.stringify(structuralChildValue(normalized))

		if (seen.has(key)) continue

		seen.add(key)
		collapsed.push(normalized)
	}

	return collapsed
}

function appendUniquePossibility(
	possibilities: StoryChild[][],
	seen: Set<string>,
	children: StoryChild[],
	limit: number,
): boolean {
	const collapsed = collapseEquivalentChildren(children)
	const key = structuralChildrenKey(collapsed)

	if (seen.has(key)) return false

	seen.add(key)
	possibilities.push(collapsed)

	return possibilities.length >= limit
}

function combineChildren(
	left: StoryChild[][],
	right: StoryChild[][],
	limit: number,
): StoryChild[][] {
	const combined: StoryChild[][] = []
	const seen = new Set<string>()

	for (const leftChildren of left) {
		for (const rightChildren of right) {
			if (
				appendUniquePossibility(
					combined,
					seen,
					[...leftChildren, ...rightChildren],
					limit,
				)
			) {
				return combined
			}
		}
	}

	return combined
}

function materializeChild(child: StoryChild, limit: number): StoryChild[][] {
	if (child.kind === `opaque`) return [[child]]
	if (child.kind === `choice`) {
		const possibilities: StoryChild[][] = []
		const seen = new Set<string>()

		for (const alternative of child.alternatives) {
			for (const children of materializeRenderStory(alternative, limit)) {
				if (appendUniquePossibility(possibilities, seen, children, limit)) {
					return possibilities
				}
			}
		}

		return possibilities
	}

	return materializeRenderStory(child.children, limit).map((children) => [
		{ ...child, children },
	])
}

export function materializeRenderStory(
	children: StoryChild[],
	limit: number,
): StoryChild[][] {
	let possibilities: StoryChild[][] = [[]]

	for (const child of children) {
		possibilities = combineChildren(
			possibilities,
			materializeChild(child, limit),
			limit,
		)
	}

	return possibilities
}
