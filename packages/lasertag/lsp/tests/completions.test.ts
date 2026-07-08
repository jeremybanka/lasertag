import { describe, expect, it } from "vitest"

import type { RenderStory } from "../../refractor/src/index.ts"
import { createCssModuleCompletionItems } from "../src/completions.ts"

const renderStory: RenderStory = {
	componentName: `AppPanel`,
	roots: [
		{
			kind: `element`,
			tagName: `app-panel`,
			attributes: [
				{ name: `class`, value: `root` },
				{ name: `data-state`, value: `open` },
			],
			children: [
				{
					kind: `element`,
					tagName: `header`,
					children: [
						{
							kind: `element`,
							tagName: `button`,
							attributes: [
								{ name: `type`, value: `button` },
								{ name: `aria-label`, value: `Close` },
							],
							children: [],
						},
					],
				},
				{
					kind: `element`,
					tagName: `footer`,
					children: [
						{
							kind: `element`,
							tagName: `a`,
							attributes: [{ name: `href`, value: `/details` }],
							children: [],
						},
					],
				},
			],
		},
	],
	warnings: [],
}

function labels(sourceText: string): string[] {
	return createCssModuleCompletionItems({
		offset: sourceText.length,
		renderStory,
		sourceText,
	}).map((item) => item.label)
}

function completion(sourceText: string, label: string) {
	return createCssModuleCompletionItems({
		offset: sourceText.length,
		renderStory,
		sourceText,
	}).find((item) => item.label === label)
}

describe(`lasertag lsp selector completions`, () => {
	it(`suggests root selectors and the module root class`, () => {
		expect(labels(``)).toEqual(
			expect.arrayContaining([`app-panel.class`, `.class`]),
		)
	})

	it(`suggests direct child tags from the render story`, () => {
		const completionLabels = labels(`app-panel.class {\n\t> `)

		expect(completionLabels).toEqual(
			expect.arrayContaining([`header`, `footer`]),
		)
		expect(completionLabels).not.toContain(`app-panel`)
	})

	it(`suggests descendant tags from the render story`, () => {
		const completionLabels = labels(`app-panel.class {\n\t> header `)

		expect(completionLabels).toEqual(expect.arrayContaining([`button`]))
		expect(completionLabels).not.toContain(`footer`)
	})

	it(`suggests observed attributes for the current tag`, () => {
		const completionLabels = labels(`app-panel.class {\n\t> header > button[`)

		expect(completionLabels).toEqual(
			expect.arrayContaining([`type`, `aria-label`]),
		)
		expect(completionLabels).not.toContain(`class`)
		expect(completionLabels).not.toContain(`href`)
	})

	it(`suggests observed literal attribute values`, () => {
		expect(labels(`app-panel.class {\n\t> header > button[type="`)).toEqual([
			`button`,
		])
	})

	it(`suggests global escape and supported pseudo refinements`, () => {
		const completionLabels = labels(`app-panel.class {\n\t&:`)

		expect(completionLabels).toEqual(
			expect.arrayContaining([
				`:global(.)`,
				`:global(...)`,
				`:hover`,
				`:focus-visible`,
				`::before`,
				`::after`,
				`:is(...)`,
				`:where(...)`,
			]),
		)
	})

	it(`reuses already-typed pseudo colons in insertion text`, () => {
		expect(
			completion(`app-panel.class {\n\t&:`, `:global(.)`)?.insertText,
		).toBe(`global(.$1)`)
		expect(completion(`app-panel.class {\n\t&:`, `::before`)?.insertText).toBe(
			`:before`,
		)
		expect(completion(`app-panel.class {\n\t&::`, `::before`)?.insertText).toBe(
			`before`,
		)
		expect(labels(`app-panel.class {\n\t&::`)).not.toContain(`:global(.)`)
	})

	it(`does not suggest unsupported selector constructs`, () => {
		const completionLabels = labels(`app-panel.class {\n\t`)

		expect(completionLabels).not.toContain(`+`)
		expect(completionLabels).not.toContain(`~`)
		expect(completionLabels).not.toContain(`:has(...)`)
		expect(completionLabels).not.toContain(`*`)
	})
})
