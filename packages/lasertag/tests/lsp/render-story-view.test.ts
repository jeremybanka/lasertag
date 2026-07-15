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
		expect(view.unreachableStyles).toMatchObject([
			{
				expected: true,
				selector: `account-panel.class > footer`,
			},
		])
	})

	it(`marks unsuppressed unreachable styles as warnings`, () => {
		const view = createView(`
			account-panel.class {
				> footer {}
			}
		`)

		expect(view.unreachableStyles).toMatchObject([
			{
				expected: false,
				selector: `account-panel.class > footer`,
			},
		])
	})

	it(`caps combinatorial render stories`, () => {
		const choice = {
			alternatives: [
				[],
				[
					{
						children: [],
						kind: `element` as const,
						tagName: `optional-item`,
					},
				],
			],
			kind: `choice` as const,
		}
		const renderStory: RenderStory = {
			componentName: `ManyWorlds`,
			roots: [
				{
					children: Array.from({ length: 6 }, () => choice),
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
