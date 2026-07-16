import { describe, expect, it } from "vitest"

import {
	analyzeCssModuleSelectors,
	analyzeCssReachability,
	analyzeTsxRenderStory,
	scopeRenderStoryToCssClassRoots,
	type RenderStory,
} from "../../src/refractor/index.ts"
import {
	createRenderStoryView,
	type RenderStoryViewNode,
} from "../../src/lsp/render-story-view.ts"

const cssPath = `/project/src/AccountPanel.module.css`
const sourcePath = `/project/src/AccountPanel.tsx`

function createView(cssSource: string) {
	const renderStory = scopeRenderStoryToCssClassRoots(
		analyzeTsxRenderStory({
			filePath: sourcePath,
			sourceText: `
				import css from "./AccountPanel.module.css"

				export function AccountPanel({ ready }: { ready: boolean }) {
					return (
						<account-panel className={css.class}>
							{ready
								? <profile-header><avatar /></profile-header>
								: <loading-state />}
						</account-panel>
					)
				}
			`,
		}),
		{ missingAttachment: `opaque` },
	)
	const selectorAnalyses = analyzeCssModuleSelectors(cssSource)
	const reachabilityAnalysis = analyzeCssReachability({
		cssSource,
		renderStory,
		selectorAnalyses,
	})

	return createRenderStoryView({
		cssPath,
		cssSource,
		reachabilityAnalysis,
		renderStory,
		sourcePath,
	})
}

function findNode(
	nodes: RenderStoryViewNode[],
	label: string,
): RenderStoryViewNode | undefined {
	for (const node of nodes) {
		if (node.label === label) return node

		const descendant = findNode(node.children, label)

		if (descendant) return descendant
	}
}

function findNodes(
	nodes: RenderStoryViewNode[],
	predicate: (node: RenderStoryViewNode) => boolean,
): RenderStoryViewNode[] {
	return nodes.flatMap((node) => [
		...(predicate(node) ? [node] : []),
		...findNodes(node.children, predicate),
	])
}

describe(`render story sidebar view`, () => {
	it(`materializes parallel stories and links supported nodes to CSS`, () => {
		const cssSource = `
			account-panel.class {
				> profile-header {}
				> loading-state {}

				/* @lasertag-expect-error: rendered by an external portal */
				> footer {}
			}
		`
		const view = createView(cssSource)

		expect(view.possibilities).toHaveLength(2)
		expect(view.truncated).toBe(false)

		const roots = view.possibilities.flatMap(({ roots }) => roots)
		const profileHeader = findNode(roots, `profile-header`)
		const loadingState = findNode(roots, `loading-state`)
		const avatar = findNode(roots, `avatar`)

		expect(profileHeader).toMatchObject({
			support: `supported`,
			tooltip: expect.stringContaining(`profile-header`),
		})
		expect(profileHeader?.location?.uri).toBe(`file://${cssPath}`)
		expect(loadingState?.support).toBe(`supported`)
		expect(avatar).toMatchObject({
			support: `none`,
			tooltip: `No matching style; open the render source`,
		})
		expect(avatar?.location?.uri).toBe(`file://${sourcePath}`)
		const expectedFooters = findNodes(roots, (node) => node.label === `footer`)

		expect(expectedFooters).toHaveLength(2)
		expect(expectedFooters).toMatchObject([
			{
				expectErrorExplanation: `rendered by an external portal`,
				support: `expected-unreachable`,
			},
			{
				expectErrorExplanation: `rendered by an external portal`,
				support: `expected-unreachable`,
			},
		])
		expect(expectedFooters[0]?.location?.uri).toBe(`file://${cssPath}`)
	})

	it(`inserts unreachable styles after the closest real selector prefix`, () => {
		const view = createView(`
			account-panel.class {
				> profile-header {
					> avatars {}
				}
			}
		`)
		const roots = view.possibilities.flatMap(({ roots }) => roots)
		const unreachableAvatars = findNodes(
			roots,
			(node) => node.kind === `selector` && node.label === `avatars`,
		)
		const actualProfileHeader = findNodes(
			roots,
			(node) => node.kind === `element` && node.label === `profile-header`,
		)[0]
		const insertedProfileHeader = findNodes(
			roots,
			(node) => node.kind === `selector` && node.label === `profile-header`,
		)[0]

		expect(unreachableAvatars).toHaveLength(2)
		expect(unreachableAvatars).toMatchObject([
			{ support: `unreachable` },
			{ support: `unreachable` },
		])
		expect(actualProfileHeader?.children).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: `selector`, label: `avatars` }),
			]),
		)
		expect(insertedProfileHeader?.children).toMatchObject([
			{ kind: `selector`, label: `avatars` },
		])
	})

	it(`merges nested unreachable selectors at their shared inserted root`, () => {
		const view = createView(`
			account-panel.class {
				> fake-thing {
					> super-fake {}
				}
			}
		`)

		for (const possibility of view.possibilities) {
			const root = possibility.roots[0]
			const fakeThings = root?.children.filter(
				(node) => node.kind === `selector` && node.label === `fake-thing`,
			)

			expect(fakeThings).toHaveLength(1)
			expect(fakeThings?.[0]).toMatchObject({
				children: [
					{
						children: [],
						kind: `selector`,
						label: `super-fake`,
					},
				],
				kind: `selector`,
				label: `fake-thing`,
			})
		}
	})

	it(`collapses structurally equivalent sibling subtrees`, () => {
		const renderStory = scopeRenderStoryToCssClassRoots(
			analyzeTsxRenderStory({
				filePath: sourcePath,
				sourceText: `
					import css from "./AccountPanel.module.css"

					export function AccountPanel() {
						return (
							<account-panel className={css.class}>
								<hello-world aria-label="First"><span /></hello-world>
								<hello-world aria-label="Second"><span /></hello-world>
								<unaccounted-for />
							</account-panel>
						)
					}
				`,
			}),
			{ missingAttachment: `opaque` },
		)
		const cssSource = `account-panel.class > bogus-tag {}`
		const selectorAnalyses = analyzeCssModuleSelectors(cssSource)
		const view = createRenderStoryView({
			cssPath,
			cssSource,
			reachabilityAnalysis: analyzeCssReachability({
				cssSource,
				renderStory,
				selectorAnalyses,
			}),
			renderStory,
			sourcePath,
		})
		const root = view.possibilities[0]?.roots[0]

		expect(root?.children.map(({ label }) => label)).toEqual([
			`hello-world`,
			`unaccounted-for`,
			`bogus-tag`,
		])
	})

	it(`caps combinatorial render stories`, () => {
		const renderStory: RenderStory = {
			componentName: `ManyWorlds`,
			roots: [
				{
					children: Array.from({ length: 6 }, (_, index) => ({
						alternatives: [
							[],
							[
								{
									children: [],
									kind: `element` as const,
									tagName: `optional-item-${index}`,
								},
							],
						],
						kind: `choice` as const,
					})),
					kind: `element`,
					tagName: `many-worlds`,
				},
			],
			warnings: [],
		}
		const cssSource = ``
		const selectorAnalyses = analyzeCssModuleSelectors(cssSource)
		const view = createRenderStoryView({
			cssPath,
			cssSource,
			reachabilityAnalysis: analyzeCssReachability({
				cssSource,
				renderStory,
				selectorAnalyses,
			}),
			renderStory,
			sourcePath,
		})

		expect(view.possibilities).toHaveLength(48)
		expect(view.truncated).toBe(true)
	})
})
