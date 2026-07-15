import { describe, expect, it } from "vitest"

import type { LasertagRenderStoryView } from "../../src/lsp/render-story-view.ts"
import { createRenderStoryTree } from "../../src/vscode/render-story-tree.ts"

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
	it(`groups parallel possibilities and colors only supported nodes`, () => {
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
			unreachableStyles: [],
		}
		const tree = createRenderStoryTree(view)

		expect(tree).toMatchObject([
			{
				children: [
					{
						children: [
							{
								label: `avatar`,
								location: sourceLocation,
							},
						],
						decoration: `supported`,
						label: `app-panel`,
						location: cssLocation,
					},
				],
				description: `AppPanel`,
				label: `Possibility 1`,
			},
		])
		expect(tree[0]?.children[0]?.children[0]).not.toHaveProperty(`decoration`)
	})

	it(`distinguishes warning and expected unreachable styles`, () => {
		const view: LasertagRenderStoryView = {
			componentName: `AppPanel`,
			cssLocation,
			kind: `ready`,
			possibilities: [],
			sourceLocation,
			truncated: false,
			unreachableStyles: [
				{
					expected: false,
					location: cssLocation,
					path: [
						{ relation: `self`, tagName: `app-panel` },
						{ relation: `child`, tagName: `footer` },
					],
					selector: `app-panel.class > footer`,
				},
				{
					expected: true,
					location: cssLocation,
					path: [
						{ relation: `self`, tagName: `app-panel` },
						{ relation: `descendant`, tagName: `portal-card` },
					],
					selector: `app-panel.class portal-card`,
				},
			],
		}
		const group = createRenderStoryTree(view)[0]

		expect(group).toMatchObject({
			children: [
				{
					children: [
						{
							decoration: `unreachable`,
							label: `footer`,
						},
					],
					label: `app-panel`,
				},
				{
					children: [
						{
							label: `… portal-card *`,
						},
					],
					label: `app-panel`,
				},
			],
			description: `2`,
			icon: `warning`,
			label: `Unreachable styles`,
		})
		expect(group?.children[1]?.children[0]).not.toHaveProperty(`decoration`)
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
