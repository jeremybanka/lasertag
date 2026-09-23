import { describe, expect, it } from "vite-plus/test"

import type { RenderStory } from "../../../src/refractor/diagnostics.ts"
import {
	findCssClassRenderRoots,
	scopeRenderStoryToCssClassRoots,
} from "../../../src/refractor/render-story-root.ts"

describe(`CSS Module render story roots`, () => {
	it(`retains uncertain class attachments after serialization and repeated scoping`, () => {
		const story: RenderStory = {
			componentName: `AppPanel`,
			warnings: [],
			roots: [
				{
					kind: `element`,
					tagName: `section`,
					mayHaveCssClass: true,
					children: [
						{
							kind: `element`,
							tagName: `app-panel`,
							attributes: [{ name: `class`, expression: `css.class` }],
							children: [{ kind: `element`, tagName: `aside`, children: [] }],
						},
					],
				},
			],
		}
		const scoped = scopeRenderStoryToCssClassRoots(story)
		expect(scoped.roots).toMatchObject([
			{ kind: `opaque`, mayContainCssClassRoot: true },
			{ kind: `element`, tagName: `app-panel` },
		])
		const restored: RenderStory = JSON.parse(JSON.stringify(scoped))
		expect(scopeRenderStoryToCssClassRoots(restored)).toEqual(scoped)
	})
	it(`retains unknown replacement alternatives through repeated scoping`, () => {
		const story: RenderStory = {
			componentName: `AppPanel`,
			warnings: [],
			roots: [
				{
					kind: `choice`,
					alternatives: [
						[
							{
								kind: `element`,
								tagName: `app-panel`,
								attributes: [{ name: `class`, expression: `css.class` }],
								children: [],
							},
						],
						[{ kind: `opaque`, reason: `unknown replacement` }],
					],
				},
			],
		}
		expect(scopeRenderStoryToCssClassRoots(story)).toEqual(story)
		expect(
			scopeRenderStoryToCssClassRoots(scopeRenderStoryToCssClassRoots(story)),
		).toEqual(story)
	})

	it(`uses the node carrying css.class as the ownership root`, () => {
		const renderStory: RenderStory = {
			componentName: `Page`,
			roots: [
				{ kind: `opaque`, reason: `unrelated island` },
				{
					children: [
						{
							attributes: [
								{
									expression: `enabled ? css.class : ""`,
									name: `class`,
								},
							],
							children: [{ children: [], kind: `element`, tagName: `header` }],
							kind: `element`,
							tagName: `owned-root`,
						},
					],
					kind: `element`,
					tagName: `layout-shell`,
				},
			],
			warnings: [],
		}

		expect(scopeRenderStoryToCssClassRoots(renderStory).roots).toMatchObject([
			{
				children: [{ kind: `element`, tagName: `header` }],
				kind: `element`,
				tagName: `owned-root`,
			},
		])
	})

	it(`keeps an unscoped story when no attachment can be discovered`, () => {
		const renderStory: RenderStory = {
			componentName: `Unknown`,
			roots: [{ children: [], kind: `element`, tagName: `unknown-root` }],
			warnings: [],
		}

		expect(scopeRenderStoryToCssClassRoots(renderStory)).toBe(renderStory)
		expect(
			scopeRenderStoryToCssClassRoots(renderStory, {
				missingAttachment: `opaque`,
			}).roots,
		).toEqual([
			{
				kind: `opaque`,
				reason: `CSS Module class attachment not found`,
			},
		])
	})

	it(`supports custom CSS Module bindings and exports`, () => {
		const roots = findCssClassRenderRoots(
			[
				{
					attributes: [
						{
							expression: `[base, styles.root]`,
							name: `class:list`,
						},
					],
					children: [],
					kind: `element`,
					tagName: `generic-root`,
				},
			],
			{ bindingName: `styles`, exportName: `root` },
		)

		expect(roots).toMatchObject([{ kind: `element`, tagName: `generic-root` }])
	})

	it(`preserves alternatives when ownership roots are conditional`, () => {
		const ownedRoot = (tagName: string) => ({
			attributes: [{ expression: `css.class`, name: `class` }],
			children: [],
			kind: `element` as const,
			tagName,
		})
		const renderStory: RenderStory = {
			componentName: `ConditionalPanel`,
			roots: [
				{
					alternatives: [
						[ownedRoot(`ready-panel`)],
						[ownedRoot(`loading-panel`)],
					],
					kind: `choice`,
				},
			],
			warnings: [],
		}

		expect(scopeRenderStoryToCssClassRoots(renderStory).roots).toMatchObject([
			{
				alternatives: [
					[{ kind: `element`, tagName: `ready-panel` }],
					[{ kind: `element`, tagName: `loading-panel` }],
				],
				kind: `choice`,
			},
		])
	})
})
