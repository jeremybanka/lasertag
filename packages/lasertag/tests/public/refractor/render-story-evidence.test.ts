import { describe, expect, it } from "vitest"

import {
	createRenderStoryEvidence,
	type RenderStory,
	type SelectorPath,
	type StoryChild,
} from "../../../src/refractor/index.ts"

function element(tagName: string, children: StoryChild[] = []): StoryChild {
	return { children, kind: `element`, tagName }
}

describe(`render story evidence`, () => {
	it(`materializes and caps structural alternatives`, () => {
		const renderStory: RenderStory = {
			componentName: `AppPanel`,
			roots: [
				element(`app-panel`, [
					{
						alternatives: [
							[element(`header`)],
							[element(`main`)],
							[element(`footer`)],
							[element(`aside`)],
						],
						kind: `choice`,
					},
				]),
			],
			warnings: [],
		}
		const selectorPath: SelectorPath = [
			{ relation: `self`, tagName: `app-panel` },
			{ relation: `child`, tagName: `missing-state` },
		]
		const evidence = createRenderStoryEvidence(renderStory, [selectorPath])

		expect(evidence?.possibilities).toHaveLength(3)
		expect(
			evidence?.possibilities.flatMap(({ roots }) => roots),
		).not.toContainEqual(expect.objectContaining({ kind: `choice` }))
	})

	it(`matches descendant selector steps through intermediate elements`, () => {
		const renderStory: RenderStory = {
			componentName: `AppPanel`,
			roots: [
				element(`app-panel`, [
					element(`layout-shell`, [element(`avatar`, [element(`span`)])]),
				]),
			],
			warnings: [],
		}
		const selectorPath: SelectorPath = [
			{ relation: `self`, tagName: `app-panel` },
			{ relation: `descendant`, tagName: `avatar` },
			{ relation: `child`, tagName: `label` },
		]
		const evidence = createRenderStoryEvidence(renderStory, [selectorPath])

		expect(evidence?.possibilities[0]).toMatchObject({
			closestPath: [`app-panel`, `layout-shell`, `avatar`],
			matchedSegments: 2,
		})
	})

	it(`collapses structurally equivalent sibling subtrees`, () => {
		const renderStory: RenderStory = {
			componentName: `AppPanel`,
			roots: [
				element(`app-panel`, [
					{
						attributes: [{ name: `aria-label`, value: `First` }],
						children: [element(`span`)],
						kind: `element`,
						range: { end: 10, start: 1 },
						tagName: `hello-world`,
					},
					{
						attributes: [{ name: `aria-label`, value: `Second` }],
						children: [element(`span`)],
						kind: `element`,
						range: { end: 30, start: 20 },
						tagName: `hello-world`,
					},
					element(`unaccounted-for`),
				]),
			],
			warnings: [],
		}
		const selectorPath: SelectorPath = [
			{ relation: `self`, tagName: `app-panel` },
			{ relation: `child`, tagName: `bogus-tag` },
		]
		const evidence = createRenderStoryEvidence(renderStory, [selectorPath])

		expect(evidence?.possibilities[0]?.roots).toMatchObject([
			{
				children: [
					{
						children: [{ tagName: `span` }],
						tagName: `hello-world`,
					},
					{ tagName: `unaccounted-for` },
				],
				tagName: `app-panel`,
			},
		])
	})

	it(`collapses structurally equivalent possibilities`, () => {
		const renderStory: RenderStory = {
			componentName: `AppPanel`,
			roots: [
				{
					alternatives: [
						[
							{
								attributes: [{ name: `aria-label`, value: `First` }],
								children: [],
								kind: `element`,
								range: { end: 10, start: 1 },
								tagName: `app-panel`,
							},
						],
						[
							{
								attributes: [{ name: `aria-label`, value: `Second` }],
								children: [],
								kind: `element`,
								range: { end: 30, start: 20 },
								tagName: `app-panel`,
							},
						],
					],
					kind: `choice`,
				},
			],
			warnings: [],
		}
		const selectorPath: SelectorPath = [
			{ relation: `self`, tagName: `app-panel` },
			{ relation: `child`, tagName: `bogus-tag` },
		]
		const evidence = createRenderStoryEvidence(renderStory, [selectorPath])

		expect(evidence?.possibilities).toHaveLength(1)
	})

	it(`keeps opaque alternatives visible without treating them as elements`, () => {
		const renderStory: RenderStory = {
			componentName: `AppPanel`,
			roots: [
				{
					alternatives: [
						[element(`app-panel`)],
						[{ kind: `opaque`, reason: `imported component` }],
					],
					kind: `choice`,
				},
			],
			warnings: [],
		}
		const selectorPath: SelectorPath = [
			{ relation: `self`, tagName: `app-panel` },
			{ relation: `child`, tagName: `footer` },
		]
		const evidence = createRenderStoryEvidence(renderStory, [selectorPath])

		expect(evidence?.possibilities).toHaveLength(2)
		expect(evidence?.possibilities[1]?.roots).toEqual([
			{ kind: `opaque`, reason: `imported component` },
		])
	})
})
