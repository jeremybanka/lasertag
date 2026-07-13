import { describe, expect, it } from "vitest"

import type { RenderStory } from "../../src/refractor/diagnostics.ts"
import {
	findCssClassRenderRoots,
	scopeRenderStoryToCssClassRoots,
} from "../../src/refractor/render-story-root.ts"

describe(`CSS Module render story roots`, () => {
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
})
