import { stripVTControlCharacters, styleText } from "node:util"

import { describe, expect, it } from "vitest"

type StoryNode = {
	children?: StoryNode[]
	tagName: string
}

type Reality = {
	condition: string
	name: string
	root: StoryNode
}

type VisualizerScenario = {
	explanation: string
	realities: Reality[]
	selector: string[]
	suggestion?: string[]
	title: string
}

const ansi = {
	accent: (text: string) => paint([`bold`, `cyan`], text),
	bad: (text: string) => paint([`bold`, `red`], text),
	bold: (text: string) => paint(`bold`, text),
	dim: (text: string) => paint(`dim`, text),
	good: (text: string) => paint([`bold`, `green`], text),
	hint: (text: string) => paint(`cyan`, text),
	warning: (text: string) => paint([`bold`, `yellow`], text),
}

function paint(format: Parameters<typeof styleText>[0], text: string): string {
	return styleText(format, text, { validateStream: false })
}

function node(tagName: string, ...children: StoryNode[]): StoryNode {
	return children.length > 0 ? { children, tagName } : { tagName }
}

function selectorText(selector: string[]): string {
	return selector.join(` > `)
}

function normalizedSelector(selector: string[]): string[] {
	return selector.map((segment) => segment.replace(/\.class$/, ``))
}

function storyPaths(root: StoryNode): string[][] {
	const paths: string[][] = []

	function visit(current: StoryNode, parentPath: string[]): void {
		const path = [...parentPath, current.tagName]

		paths.push(path)

		for (const child of current.children ?? []) visit(child, path)
	}

	visit(root, [])
	return paths
}

function commonPrefixLength(left: string[], right: string[]): number {
	let length = 0

	while (left[length] !== undefined && left[length] === right[length]) length++

	return length
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

function closestPath(reality: Reality, selector: string[]): string[] {
	const wanted = normalizedSelector(selector)

	return (
		storyPaths(reality.root).sort((left, right) => {
			const rightPrefix = commonPrefixLength(right, wanted)
			const leftPrefix = commonPrefixLength(left, wanted)

			if (rightPrefix !== leftPrefix) return rightPrefix - leftPrefix

			const expected = wanted[Math.min(leftPrefix, wanted.length - 1)] ?? ``
			const leftCandidate = left[Math.min(leftPrefix, left.length - 1)] ?? ``
			const rightCandidate =
				right[Math.min(rightPrefix, right.length - 1)] ?? ``

			return (
				editDistance(leftCandidate, expected) -
				editDistance(rightCandidate, expected)
			)
		})[0] ?? [reality.root.tagName]
	)
}

function renderTree(
	root: StoryNode,
	highlightPath: string[] = [],
	wantedPath: string[] = [],
): string[] {
	const output: string[] = []

	function visit(
		current: StoryNode,
		parentPath: string[],
		prefix: string,
		isLast: boolean,
	): void {
		const path = [...parentPath, current.tagName]
		const onClosestPath =
			path.every((segment, index) => highlightPath[index] === segment) &&
			path.length <= highlightPath.length
		const matchesSelector =
			onClosestPath &&
			path.every((segment, index) => wantedPath[index] === segment)
		const branch = parentPath.length === 0 ? `` : isLast ? `└─ ` : `├─ `
		const branchColor = matchesSelector
			? ansi.hint
			: onClosestPath
				? ansi.warning
				: ansi.dim
		const tag = matchesSelector
			? ansi.accent(current.tagName)
			: onClosestPath
				? ansi.warning(current.tagName)
				: current.tagName
		const nearest =
			path.length === highlightPath.length && onClosestPath
				? ansi.warning(`  ← closest rendered path`)
				: ``

		output.push(`${ansi.dim(prefix)}${branchColor(branch)}${tag}${nearest}`)

		const children = current.children ?? []
		const continuation = parentPath.length === 0 ? `` : isLast ? `   ` : `│  `

		for (const [index, child] of children.entries()) {
			visit(
				child,
				path,
				`${prefix}${continuation}`,
				index === children.length - 1,
			)
		}
	}

	visit(root, [], ``, true)
	return output
}

function formatStoryAtlas(scenario: VisualizerScenario): string {
	const wanted = normalizedSelector(scenario.selector)
	const output = [
		ansi.bold(`Why this selector is unreachable`),
		``,
		`  ${ansi.bad(selectorText(scenario.selector))}`,
		`  ${ansi.dim(`╰─`)} ${scenario.explanation}`,
		``,
		`${ansi.bold(`Parallel render stories`)}  ${ansi.dim(`${scenario.realities.length} realities · each tree stands alone`)}`,
	]

	for (const [index, reality] of scenario.realities.entries()) {
		const closest = closestPath(reality, scenario.selector)
		const matched = commonPrefixLength(closest, wanted)
		const branch = index === scenario.realities.length - 1 ? `└` : `├`

		output.push(
			``,
			`${ansi.dim(`${branch}─`)} ${ansi.bold(`Reality ${index + 1} · ${reality.name}`)}  ${ansi.dim(reality.condition)}`,
			`   ${ansi.dim(`closest path matches`)} ${ansi.warning(`${matched}/${wanted.length}`)} ${ansi.dim(`selector steps`)}`,
			...renderTree(reality.root, closest, wanted).map((line) => `   ${line}`),
		)
	}

	if (scenario.suggestion) {
		output.push(
			``,
			`${ansi.good(`Likely fix`)}  ${selectorText(scenario.suggestion)}`,
		)
	}

	return output.join(`\n`)
}

function formatPathEvidence(
	scenario: VisualizerScenario,
	paths: Array<{ finding: string; path: string[]; reality: string }>,
): string {
	const realityWidth = Math.max(...paths.map(({ reality }) => reality.length))
	const output = [
		ansi.bold(`Path evidence across parallel realities`),
		``,
		`  ${ansi.dim(`Wanted`)}  ${ansi.bad(selectorText(scenario.selector))}`,
		``,
		...paths.map(
			({ finding, path, reality }) =>
				`  ${ansi.bold(reality.padEnd(realityWidth))}  ${ansi.hint(path.join(` › `))}\n${` `.repeat(realityWidth + 4)}${ansi.dim(`╰─`)} ${finding}`,
		),
	]

	if (scenario.suggestion) {
		const before = normalizedSelector(scenario.selector)
		const after = normalizedSelector(scenario.suggestion)
		const inserted = after.filter((segment) => !before.includes(segment))

		output.push(
			``,
			`${ansi.warning(`Structural mismatch`)}`,
			`  ${ansi.bad(`− ${before.join(` > `)}`)}`,
			`  ${ansi.good(`+ ${after.join(` > `)}`)}`,
			inserted.length > 0
				? `    ${ansi.dim(`insert`)} ${ansi.accent(inserted.join(` > `))} ${ansi.dim(`before the matching descendants`)}`
				: ``,
		)
	}

	return output.join(`\n`)
}

function ansiLength(text: string): number {
	return stripVTControlCharacters(text).length
}

function padAnsi(text: string, width: number): string {
	return `${text}${` `.repeat(Math.max(width - ansiLength(text), 0))}`
}

function compactReality(reality: Reality): string[] {
	return [
		ansi.bold(reality.name),
		ansi.dim(reality.condition),
		``,
		...renderTree(reality.root),
	]
}

function formatRealityLanes(scenario: VisualizerScenario): string {
	const lanes = scenario.realities.map(compactReality)
	const laneWidth = Math.max(
		26,
		...lanes.flatMap((lane) => lane.map((line) => ansiLength(line) + 2)),
	)
	const height = Math.max(...lanes.map((lane) => lane.length))
	const rows = Array.from({ length: height }, (_, rowIndex) =>
		lanes
			.map((lane) => padAnsi(lane[rowIndex] ?? ``, laneWidth))
			.join(ansi.dim(`│ `)),
	)

	return [
		ansi.bold(`Reality lanes`),
		ansi.dim(
			`Every column is a complete possible render—not a branch in one tree.`,
		),
		``,
		...rows,
		``,
		`${ansi.bad(`No lane renders`)} ${ansi.bold(selectorText(scenario.selector))}`,
		`  ${ansi.dim(`╰─`)} ${scenario.explanation}`,
	].join(`\n`)
}

const misspelledSelector: VisualizerScenario = {
	explanation: `“avater” never appears; “avatar” is one edit away in the ready reality.`,
	realities: [
		{
			condition: `while account data is loading`,
			name: `loading`,
			root: node(`account-panel`, node(`loading-state`, node(`spinner-ring`))),
		},
		{
			condition: `when account data is ready`,
			name: `ready`,
			root: node(
				`account-panel`,
				node(`profile-header`, node(`avatar`), node(`display-name`)),
				node(`action-bar`, node(`button`), node(`a`)),
			),
		},
		{
			condition: `when account data fails`,
			name: `failure`,
			root: node(`account-panel`, node(`error-state`, node(`retry-button`))),
		},
	],
	selector: [`account-panel.class`, `profile-header`, `avater`],
	suggestion: [`account-panel.class`, `profile-header`, `avatar`],
	title: `misspelled selector`,
}

const misplacedSelector: VisualizerScenario = {
	explanation: `message-row exists, but only beneath message-list—not directly beneath inbox-panel.`,
	realities: [
		{
			condition: `when there are no messages`,
			name: `empty`,
			root: node(`inbox-panel`, node(`empty-state`, node(`p`))),
		},
		{
			condition: `when messages are available`,
			name: `populated`,
			root: node(
				`inbox-panel`,
				node(
					`message-list`,
					node(`message-row`, node(`avatar`), node(`message-summary`)),
				),
			),
		},
		{
			condition: `when one message is selected`,
			name: `selected`,
			root: node(
				`inbox-panel`,
				node(
					`detail-pane`,
					node(`message-card`, node(`avatar`), node(`article`)),
				),
			),
		},
	],
	selector: [`inbox-panel.class`, `message-row`, `avatar`],
	suggestion: [`inbox-panel.class`, `message-list`, `message-row`, `avatar`],
	title: `misplaced selector`,
}

const absentState: VisualizerScenario = {
	explanation: `error-banner is absent from guest, shipping, and pickup realities; the CSS may be stale or the state may be unimplemented.`,
	realities: [
		{
			condition: `before identification`,
			name: `guest`,
			root: node(
				`checkout-panel`,
				node(`contact-form`, node(`email-field`), node(`continue-button`)),
			),
		},
		{
			condition: `delivery selected`,
			name: `shipping`,
			root: node(
				`checkout-panel`,
				node(`address-form`, node(`street-field`), node(`postal-field`)),
				node(`order-summary`, node(`total-row`)),
			),
		},
		{
			condition: `store pickup selected`,
			name: `pickup`,
			root: node(
				`checkout-panel`,
				node(`store-picker`, node(`store-row`), node(`map-link`)),
				node(`order-summary`, node(`total-row`)),
			),
		},
	],
	selector: [`checkout-panel.class`, `error-banner`],
	title: `missing state`,
}

describe(`experimental ANSI render story visualizer`, () => {
	it(`concept A — story atlas diagnoses a likely typo`, () => {
		const output = formatStoryAtlas(misspelledSelector)

		console.log(`\n${output}\n`)
		expect(stripVTControlCharacters(output)).toContain(
			`Reality 2 · ready  when account data is ready`,
		)
		expect(stripVTControlCharacters(output)).toContain(
			`Likely fix  account-panel.class > profile-header > avatar`,
		)
	})

	it(`concept B — path evidence exposes a misplaced selector`, () => {
		const output = formatPathEvidence(misplacedSelector, [
			{
				finding: `the branch ends before message-row`,
				path: [`inbox-panel`, `empty-state`],
				reality: `empty`,
			},
			{
				finding: `message-list is the missing structural step`,
				path: [`inbox-panel`, `message-list`, `message-row`, `avatar`],
				reality: `populated`,
			},
			{
				finding: `avatar exists here, but beneath a different parent chain`,
				path: [`inbox-panel`, `detail-pane`, `message-card`, `avatar`],
				reality: `selected`,
			},
		])

		console.log(`\n${output}\n`)
		expect(stripVTControlCharacters(output)).toContain(
			`+ inbox-panel > message-list > message-row > avatar`,
		)
		expect(stripVTControlCharacters(output)).toContain(
			`insert message-list before the matching descendants`,
		)
	})

	it(`concept C — lanes preserve complete parallel realities`, () => {
		const output = formatRealityLanes(absentState)

		console.log(`\n${output}\n`)
		expect(stripVTControlCharacters(output)).toContain(
			`Every column is a complete possible render—not a branch in one tree.`,
		)
		expect(stripVTControlCharacters(output)).toContain(
			`No lane renders checkout-panel.class > error-banner`,
		)
	})
})
