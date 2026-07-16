import { pathToFileURL } from "node:url"

import type {
	CssReachabilityAnalysis,
	CssSelectorReachabilityAnalysis,
} from "../refractor/validate-css-reachability.ts"
import type {
	RenderStory,
	SelectorPath,
	SourceRange,
	StoryChild,
	StoryNode,
} from "../refractor/diagnostics.ts"
import { findLasertagExpectErrorExplanation } from "../refractor/expect-error.ts"
import { findClosestRenderStoryPath } from "../refractor/render-story-evidence.ts"

export const LASERTAG_RENDER_STORY_REQUEST = `lasertag/renderStory`
export const LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION = `lasertag/renderStoryChanged`

const MAX_RENDER_STORY_POSSIBILITIES = 48

export type LasertagRenderStoryRequest = {
	uri: string
}

export type LasertagRenderStoryChangedNotification = {
	uri: string
}

export type RenderStoryViewLocation = {
	end: number
	start: number
	uri: string
}

export type RenderStoryViewNode = {
	children: RenderStoryViewNode[]
	expectErrorExplanation?: string
	kind: `element` | `opaque` | `selector`
	label: string
	location?: RenderStoryViewLocation
	support: `expected-unreachable` | `none` | `supported` | `unreachable`
	tooltip?: string
}

export type RenderStoryViewPossibility = {
	roots: RenderStoryViewNode[]
}

export type RenderStoryViewUnreachableStyle = {
	expected: boolean
	expectErrorExplanation?: string
	location: RenderStoryViewLocation
	path: SelectorPath
	selector: string
}

export type LasertagRenderStoryView =
	| {
			kind: `outside-context`
	  }
	| {
			cssLocation?: RenderStoryViewLocation
			kind: `unavailable`
			message: string
			sourceLocation?: RenderStoryViewLocation
	  }
	| {
			componentName: string
			cssLocation: RenderStoryViewLocation
			kind: `ready`
			possibilities: RenderStoryViewPossibility[]
			sourceLocation: RenderStoryViewLocation
			truncated: boolean
	  }

export type CreateRenderStoryViewOptions = {
	cssPath: string
	cssSource: string
	reachabilityAnalysis: CssReachabilityAnalysis
	renderStory: RenderStory
	sourcePath: string
}

function location(
	filePath: string,
	range: SourceRange = { end: 0, start: 0 },
): RenderStoryViewLocation {
	return {
		...range,
		uri: pathToFileURL(filePath).href,
	}
}

function appendPossibilities(
	left: StoryChild[][],
	right: StoryChild[][],
	limit: number,
): StoryChild[][] {
	const possibilities: StoryChild[][] = []

	for (const leftChildren of left) {
		for (const rightChildren of right) {
			possibilities.push([...leftChildren, ...rightChildren])

			if (possibilities.length >= limit) return possibilities
		}
	}

	return possibilities
}

function materializeChild(child: StoryChild, limit: number): StoryChild[][] {
	if (child.kind === `opaque`) return [[child]]
	if (child.kind === `choice`) {
		return child.alternatives
			.flatMap((alternative) => materializeChildren(alternative, limit))
			.slice(0, limit)
	}

	return materializeChildren(child.children, limit).map((children) => [
		{ ...child, children },
	])
}

function materializeChildren(
	children: StoryChild[],
	limit: number,
): StoryChild[][] {
	let possibilities: StoryChild[][] = [[]]

	for (const child of children) {
		possibilities = appendPossibilities(
			possibilities,
			materializeChild(child, limit),
			limit,
		)
	}

	return possibilities
}

function selectorPathMatchesNodePath(
	selectorPath: SelectorPath,
	nodePath: StoryNode[],
): boolean {
	if (selectorPath.length === 0 || nodePath.length === 0) return false
	if (selectorPath[0]?.tagName !== nodePath[0]?.tagName) return false

	function matchesFrom(selectorIndex: number, nodeIndex: number): boolean {
		if (selectorIndex >= selectorPath.length) {
			return nodeIndex === nodePath.length - 1
		}

		const segment = selectorPath[selectorIndex]

		if (!segment) return false

		if (segment.relation === `child`) {
			const childIndex = nodeIndex + 1

			return (
				nodePath[childIndex]?.tagName === segment.tagName &&
				matchesFrom(selectorIndex + 1, childIndex)
			)
		}

		if (segment.relation !== `descendant`) return false

		for (
			let descendantIndex = nodeIndex + 1;
			descendantIndex < nodePath.length;
			descendantIndex += 1
		) {
			if (
				nodePath[descendantIndex]?.tagName === segment.tagName &&
				matchesFrom(selectorIndex + 1, descendantIndex)
			) {
				return true
			}
		}

		return false
	}

	return matchesFrom(1, 0)
}

function supportingSelector(
	selectorAnalyses: CssSelectorReachabilityAnalysis[],
	nodePath: StoryNode[],
): CssSelectorReachabilityAnalysis | undefined {
	return selectorAnalyses
		.filter(
			(analysis) =>
				analysis.resultKind === `path` &&
				analysis.reachability !== `unreachable` &&
				analysis.paths.some(({ path }) =>
					selectorPathMatchesNodePath(path, nodePath),
				),
		)
		.toSorted(
			(left, right) =>
				Math.max(...right.paths.map(({ path }) => path.length)) -
					Math.max(...left.paths.map(({ path }) => path.length)) ||
				left.range.start - right.range.start,
		)[0]
}

function createViewNode(
	child: StoryChild,
	parentPath: StoryNode[],
	options: CreateRenderStoryViewOptions,
): RenderStoryViewNode {
	if (child.kind === `opaque`) {
		return {
			children: [],
			kind: `opaque`,
			label: `unknown branch`,
			...(child.range
				? { location: location(options.sourcePath, child.range) }
				: {}),
			support: `none`,
			tooltip: child.reason,
		}
	}

	if (child.kind === `choice`) {
		throw new Error(`Render story choices must be materialized before display.`)
	}

	const nodePath = [...parentPath, child]
	const selector = supportingSelector(
		options.reachabilityAnalysis.selectorReachability,
		nodePath,
	)

	return {
		children: child.children.map((descendant) =>
			createViewNode(descendant, nodePath, options),
		),
		kind: `element`,
		label: child.tagName,
		...(selector
			? { location: location(options.cssPath, selector.range) }
			: child.range
				? { location: location(options.sourcePath, child.range) }
				: {}),
		support: selector ? `supported` : `none`,
		tooltip: selector
			? `Styled by ${selector.selector}`
			: `No matching style; open the render source`,
	}
}

function hasDeadSelectorDiagnostic(
	analysis: CssSelectorReachabilityAnalysis,
	reachabilityAnalysis: CssReachabilityAnalysis,
): boolean {
	return reachabilityAnalysis.diagnostics.some(
		(diagnostic) =>
			diagnostic.code === `dead-selector` &&
			diagnostic.range?.start === analysis.range.start &&
			diagnostic.range.end === analysis.range.end,
	)
}

function unreachableStyles(
	options: CreateRenderStoryViewOptions,
): RenderStoryViewUnreachableStyle[] {
	return options.reachabilityAnalysis.selectorReachability
		.filter(
			(analysis) =>
				analysis.resultKind === `path` &&
				analysis.reachability === `unreachable`,
		)
		.flatMap((analysis) =>
			analysis.paths.map(({ path }) => {
				const expected = !hasDeadSelectorDiagnostic(
					analysis,
					options.reachabilityAnalysis,
				)
				const expectErrorExplanation = expected
					? findLasertagExpectErrorExplanation(
							options.cssSource,
							analysis.range.start,
						)
					: undefined

				return {
					expected,
					...(expectErrorExplanation === undefined
						? {}
						: { expectErrorExplanation }),
					location: location(options.cssPath, analysis.range),
					path,
					selector: analysis.selector,
				}
			}),
		)
}

function matchedActualPath(
	closestPath: string[],
	selectorPath: SelectorPath,
	matchedSegments: number,
): string[] {
	if (matchedSegments === 0) return []

	let actualIndex = 0

	for (
		let selectorIndex = 1;
		selectorIndex < matchedSegments;
		selectorIndex += 1
	) {
		const segment = selectorPath[selectorIndex]

		if (!segment) break

		actualIndex =
			segment.relation === `child`
				? actualIndex + 1
				: closestPath.indexOf(segment.tagName, actualIndex + 1)
	}

	return closestPath.slice(0, actualIndex + 1)
}

function unreachableBranch(
	style: RenderStoryViewUnreachableStyle,
	segments: SelectorPath,
): RenderStoryViewNode | undefined {
	const [segment, ...descendants] = segments

	if (!segment) return

	const child = unreachableBranch(style, descendants)
	const terminal = child === undefined
	const label = `${segment.relation === `descendant` ? `… ` : ``}${segment.tagName}`

	return {
		children: child ? [child] : [],
		...(terminal && style.expectErrorExplanation !== undefined
			? { expectErrorExplanation: style.expectErrorExplanation }
			: {}),
		kind: `selector`,
		label,
		location: style.location,
		support: style.expected ? `expected-unreachable` : `unreachable`,
		tooltip: style.expected
			? `${style.selector}\nExpected with @lasertag-expect-error: ${style.expectErrorExplanation ?? ``}`
			: `${style.selector}\nStyled, but unreachable in this render story`,
	}
}

function mergeSelectorBranch(
	children: RenderStoryViewNode[],
	branch: RenderStoryViewNode,
): RenderStoryViewNode[] {
	const matchingIndex = children.findIndex(
		(child) => child.kind === `selector` && child.label === branch.label,
	)

	if (matchingIndex === -1) return [...children, branch]

	const matching = children[matchingIndex]

	if (!matching) return [...children, branch]

	const mergedChildren = branch.children.reduce(
		(current, descendant) => mergeSelectorBranch(current, descendant),
		matching.children,
	)
	const merged = { ...branch, ...matching, children: mergedChildren }

	return children.map((child, index) =>
		index === matchingIndex ? merged : child,
	)
}

function insertUnreachableStyle(
	roots: RenderStoryViewNode[],
	storyRoots: StoryChild[],
	style: RenderStoryViewUnreachableStyle,
): RenderStoryViewNode[] {
	const closest = findClosestRenderStoryPath(storyRoots, style.path)
	const branch = unreachableBranch(
		style,
		style.path.slice(closest.matchedSegments),
	)

	if (!branch) return roots
	const insertedBranch = branch

	const parentPath = matchedActualPath(
		closest.closestPath,
		style.path,
		closest.matchedSegments,
	)

	if (parentPath.length === 0) return mergeSelectorBranch(roots, branch)

	let inserted = false

	function visit(
		node: RenderStoryViewNode,
		ancestors: string[],
	): RenderStoryViewNode {
		if (node.kind !== `element`) return node

		const path = [...ancestors, node.label]
		const children = node.children.map((child) => visit(child, path))

		if (
			!inserted &&
			path.length === parentPath.length &&
			path.every((segment, index) => parentPath[index] === segment)
		) {
			const mergedChildren = mergeSelectorBranch(children, insertedBranch)
			inserted = true

			return { ...node, children: mergedChildren }
		}

		return { ...node, children }
	}

	return roots.map((root) => visit(root, []))
}

export function createRenderStoryView(
	options: CreateRenderStoryViewOptions,
): Extract<LasertagRenderStoryView, { kind: `ready` }> {
	const materialized = materializeChildren(
		options.renderStory.roots,
		MAX_RENDER_STORY_POSSIBILITIES + 1,
	)
	const truncated = materialized.length > MAX_RENDER_STORY_POSSIBILITIES
	const styles = unreachableStyles(options).toSorted(
		(left, right) => left.path.length - right.path.length,
	)
	const possibilities = materialized
		.slice(0, MAX_RENDER_STORY_POSSIBILITIES)
		.map(
			(roots): RenderStoryViewPossibility => ({
				roots: styles.reduce(
					(viewRoots, style) => insertUnreachableStyle(viewRoots, roots, style),
					roots.map((root) => createViewNode(root, [], options)),
				),
			}),
		)

	return {
		componentName: options.renderStory.componentName,
		cssLocation: location(options.cssPath),
		kind: `ready`,
		possibilities,
		sourceLocation: location(options.sourcePath),
		truncated,
	}
}
