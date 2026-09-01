import { describe, expect, it } from "vitest"

import type { LasertagRenderStoryView } from "../../../src/lsp/render-story-view.ts"
import { createRenderStoryTree } from "../../../src/vscode/render-story-tree.ts"

const cssLocation = {
	end: 12,
	start: 4,
	uri: `file:///project/src/AppPanel.module.css`,
}
const sourceLocation = {
	end: 24,
	start: 16,
	uri: `file:///project/src/AppPanel.tsx`,
}

describe(`VSCode render story tree`, () => {
	it(`expands parallel possibilities with aligned support icons and colors`, () => {
		const view: LasertagRenderStoryView = {
			componentName: `AppPanel`,
			cssLocation,
			kind: `ready`,
			possibilities: [
				{
					roots: [
						{
							children: [
								{
									children: [],
									kind: `element`,
									label: `avatar`,
									location: sourceLocation,
									support: `none`,
								},
							],
							kind: `element`,
							label: `app-panel`,
							location: cssLocation,
							support: `supported`,
						},
					],
				},
			],
			sourceLocation,
			truncated: false,
		}
		const tree = createRenderStoryTree(view)

		expect(tree).toMatchObject([
			{
				children: [
					{
						children: [
							{
								decoration: `unsupported`,
								icon: `circle-slash`,
								label: `avatar`,
								location: sourceLocation,
							},
						],
						decoration: `regular`,
						expanded: true,
						icon: `pass`,
						label: `app-panel`,
						location: cssLocation,
					},
				],
				decoration: `regular`,
				description: `AppPanel`,
				expanded: true,
				icon: `list-tree`,
				label: `Possibility 1`,
			},
		])
	})

	it(`keeps unreachable selectors in the story with warning or expected styling`, () => {
		const view: LasertagRenderStoryView = {
			componentName: `AppPanel`,
			cssLocation,
			kind: `ready`,
			possibilities: [
				{
					roots: [
						{
							children: [
								{
									children: [],
									kind: `selector`,
									label: `footer`,
									location: cssLocation,
									support: `unreachable`,
								},
								{
									children: [],
									expectErrorExplanation: `rendered by a portal`,
									kind: `selector`,
									label: `… portal-card`,
									location: cssLocation,
									support: `expected-unreachable`,
								},
							],
							kind: `element`,
							label: `app-panel`,
							location: cssLocation,
							support: `supported`,
						},
					],
				},
			],
			sourceLocation,
			truncated: false,
		}
		const possibility = createRenderStoryTree(view)[0]

		expect(possibility).toMatchObject({
			children: [
				{
					children: [
						{
							decoration: `unreachable`,
							icon: `warning`,
							label: `footer`,
						},
						{
							decoration: `regular`,
							description: `rendered by a portal`,
							icon: `info`,
							label: `… portal-card`,
						},
					],
					decoration: `regular`,
					icon: `pass`,
					label: `app-panel`,
				},
			],
			expanded: true,
			label: `Possibility 1`,
		})
	})

	it(`shows analysis availability without inventing a story`, () => {
		expect(createRenderStoryTree({ kind: `outside-context` })).toEqual([])
		expect(
			createRenderStoryTree({
				cssLocation,
				kind: `unavailable`,
				message: `No render source found.`,
			}),
		).toMatchObject([
			{
				icon: `info`,
				label: `No render source found.`,
				location: cssLocation,
			},
		])
	})
})
