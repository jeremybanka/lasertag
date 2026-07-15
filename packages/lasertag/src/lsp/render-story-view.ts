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
	kind: `element` | `opaque`
	label: string
	location?: RenderStoryViewLocation
	support: `none` | `supported`
	tooltip?: string
}

export type RenderStoryViewPossibility = {
	roots: RenderStoryViewNode[]
}

export type RenderStoryViewUnreachableStyle = {
	expected: boolean
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
			unreachableStyles: RenderStoryViewUnreachableStyle[]
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
			analysis.paths.map(({ path }) => ({
				expected: !hasDeadSelectorDiagnostic(
					analysis,
					options.reachabilityAnalysis,
				),
				location: location(options.cssPath, analysis.range),
				path,
				selector: analysis.selector,
			})),
		)
}

export function createRenderStoryView(
	options: CreateRenderStoryViewOptions,
): Extract<LasertagRenderStoryView, { kind: `ready` }> {
	const materialized = materializeChildren(
		options.renderStory.roots,
		MAX_RENDER_STORY_POSSIBILITIES + 1,
	)
	const truncated = materialized.length > MAX_RENDER_STORY_POSSIBILITIES
	const possibilities = materialized
		.slice(0, MAX_RENDER_STORY_POSSIBILITIES)
		.map(
			(roots): RenderStoryViewPossibility => ({
				roots: roots.map((root) => createViewNode(root, [], options)),
			}),
		)

	return {
		componentName: options.renderStory.componentName,
		cssLocation: location(options.cssPath),
		kind: `ready`,
		possibilities,
		sourceLocation: location(options.sourcePath),
		truncated,
		unreachableStyles: unreachableStyles(options),
	}
}
