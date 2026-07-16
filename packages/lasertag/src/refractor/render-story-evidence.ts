import type {
	RenderStory,
	RenderStoryEvidence,
	RenderStoryEvidencePossibility,
	SelectorPath,
	StoryChild,
} from "./diagnostics.ts"
import { materializeRenderStory } from "./materialize-render-story.ts"

const DEFAULT_MAX_POSSIBILITIES = 3
const MAX_MATERIALIZED_POSSIBILITIES = 48

type ScoredPossibility = RenderStoryEvidencePossibility & {
	distance: number
}

function elementPaths(children: StoryChild[]): string[][] {
	const paths: string[][] = []

	function visit(child: StoryChild, parentPath: string[]): void {
		if (child.kind === `opaque`) return
		if (child.kind === `choice`) {
			for (const alternative of child.alternatives) {
				for (const alternativeChild of alternative) {
					visit(alternativeChild, parentPath)
				}
			}
			return
		}

		const path = [...parentPath, child.tagName]
		paths.push(path)

		for (const nestedChild of child.children) visit(nestedChild, path)
	}

	for (const child of children) visit(child, [])
	return paths
}

function editDistance(left: string, right: string): number {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index)

	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		let diagonal = row[0] ?? 0
		row[0] = leftIndex

		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			const above = row[rightIndex] ?? 0
			const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1

			row[rightIndex] = Math.min(
				(row[rightIndex] ?? 0) + 1,
				(row[rightIndex - 1] ?? 0) + 1,
				diagonal + cost,
			)
			diagonal = above
		}
	}

	return row[right.length] ?? 0
}

function scorePath(
	actualPath: string[],
	selectorPath: SelectorPath,
): { distance: number; matchedSegments: number } {
	const rootSegment = selectorPath[0]

	if (!rootSegment || actualPath[0] !== rootSegment.tagName) {
		return {
			distance: editDistance(actualPath[0] ?? ``, rootSegment?.tagName ?? ``),
			matchedSegments: 0,
		}
	}

	let actualIndex = 0
	let matchedSegments = 1

	for (
		let selectorIndex = 1;
		selectorIndex < selectorPath.length;
		selectorIndex++
	) {
		const segment = selectorPath[selectorIndex]

		if (!segment) break

		if (segment.relation === `child`) {
			actualIndex += 1
			if (actualPath[actualIndex] !== segment.tagName) {
				return {
					distance: editDistance(
						actualPath[actualIndex] ?? ``,
						segment.tagName,
					),
					matchedSegments,
				}
			}
			matchedSegments += 1
			continue
		}

		const descendantIndex = actualPath.indexOf(segment.tagName, actualIndex + 1)

		if (descendantIndex === -1) {
			return {
				distance: editDistance(
					actualPath[actualIndex + 1] ?? ``,
					segment.tagName,
				),
				matchedSegments,
			}
		}

		actualIndex = descendantIndex
		matchedSegments += 1
	}

	return { distance: 0, matchedSegments }
}

export function findClosestRenderStoryPath(
	roots: StoryChild[],
	selectorPath: SelectorPath,
): { closestPath: string[]; distance: number; matchedSegments: number } {
	const paths = elementPaths(roots)

	return (
		paths
			.map((path) => ({ closestPath: path, ...scorePath(path, selectorPath) }))
			.toSorted(
				(left, right) =>
					right.matchedSegments - left.matchedSegments ||
					left.distance - right.distance ||
					left.closestPath.length - right.closestPath.length,
			)[0] ?? { closestPath: [], distance: Infinity, matchedSegments: 0 }
	)
}

function evidenceForPath(
	renderStory: RenderStory,
	selectorPath: SelectorPath,
	maxPossibilities: number,
): RenderStoryEvidence {
	const scored = materializeRenderStory(
		renderStory.roots,
		MAX_MATERIALIZED_POSSIBILITIES,
	).map((roots): ScoredPossibility => {
		const closest = findClosestRenderStoryPath(roots, selectorPath)

		return { roots, ...closest }
	})
	const possibilities = scored
		.toSorted(
			(left, right) =>
				right.matchedSegments - left.matchedSegments ||
				left.distance - right.distance,
		)
		.slice(0, maxPossibilities)
		.map(({ distance: _, ...possibility }) => possibility)

	return { possibilities, selectorPath }
}

export function createRenderStoryEvidence(
	renderStory: RenderStory,
	selectorPaths: SelectorPath[],
	maxPossibilities = DEFAULT_MAX_POSSIBILITIES,
): RenderStoryEvidence | undefined {
	return selectorPaths
		.map((selectorPath) =>
			evidenceForPath(renderStory, selectorPath, maxPossibilities),
		)
		.toSorted((left, right) => {
			const leftMatch = left.possibilities[0]?.matchedSegments ?? 0
			const rightMatch = right.possibilities[0]?.matchedSegments ?? 0

			return rightMatch - leftMatch
		})[0]
}
