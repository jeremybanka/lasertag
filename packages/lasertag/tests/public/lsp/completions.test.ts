import { afterAll, describe, expect, it } from "vite-plus/test"
import {
	CompletionItemKind,
	InsertTextFormat,
	type CompletionItem,
} from "vscode-languageserver/node"

import type { RenderStory } from "../../../src/refractor/index.ts"
import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import { validateCssReachability } from "../../../src/refractor/validate-css-reachability.ts"
import { createCssModuleCompletionItems } from "../../../src/lsp/completions.ts"

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
	it.each([`/* @lasertag-exp`, `/* @lasertag-expect-error: `])(
		`suggests an expect-error snippet after typing %s`,
		(typedComment) => {
			expect(labels(`app-panel.class {\n\t${typedComment}`)).toEqual([
				`@lasertag-expect-error`,
			])
		},
	)

	it.each([`/`, `/*`, `/* `, `/* @`, `/* @lasertag-`])(
		`suggests every diagnostic directive after typing %s`,
		(typedComment) => {
			expect(labels(`app-panel.class {\n\t${typedComment}`)).toEqual([
				`@lasertag-disable`,
				`@lasertag-enable`,
				`@lasertag-expect-error`,
			])
		},
	)

	it(`replaces the partial comment and places the cursor in the explanation`, () => {
		const sourceText = `app-panel.class {\n\t/* @laser`
		const item = completion(sourceText, `@lasertag-expect-error`)

		expect(item).toMatchObject({
			filterText: `/* @lasertag-expect-error: `,
			insertTextFormat: InsertTextFormat.Snippet,
			kind: CompletionItemKind.Snippet,
			textEdit: {
				newText: `/* @lasertag-expect-error: $1 */`,
				range: {
					end: { character: 10, line: 1 },
					start: { character: 1, line: 1 },
				},
			},
		})
	})

	it.each([`disable`, `enable`] as const)(
		`completes a diagnostic-scoped %s directive`,
		(directive) => {
			const sourceText = `app-panel.class {\n\t/* @lasertag-${directive}`
			const item = completion(sourceText, `@lasertag-${directive}`)

			expect(item).toMatchObject({
				filterText: `/* @lasertag-${directive} [`,
				insertTextFormat: InsertTextFormat.Snippet,
				kind: CompletionItemKind.Snippet,
				textEdit: {
					newText:
						directive === `disable`
							? `/* @lasertag-disable [\${1|dead-selector,impossible-local-class,opaque-component-root-may-collide,selector-crosses-ownership-boundary,selector-matches-foreign-component-root|}] $2 */`
							: `/* @lasertag-enable [\${1|dead-selector,impossible-local-class,opaque-component-root-may-collide,selector-crosses-ownership-boundary,selector-matches-foreign-component-root|}] */`,
					range: {
						end: { character: 14 + directive.length, line: 1 },
						start: { character: 1, line: 1 },
					},
				},
			})
		},
	)

	it(`does not suggest the expect-error snippet for unrelated comment text`, () => {
		expect(labels(`app-panel.class {\n\t/* regular`)).not.toContain(
			`@lasertag-expect-error`,
		)
	})

	it(`suggests the root tag with the module class, never the class alone`, () => {
		const completionLabels = labels(``)

		expect(completionLabels).toContain(`app-panel.class`)
		expect(completionLabels).not.toContain(`.class`)
	})

	it(`suggests tags for a selector with a comment above it`, () => {
		expect(labels(`app-panel.class {\n\t/* layout */\n\t> `)).toEqual(
			expect.arrayContaining([`header`, `footer`]),
		)
		expect(
			labels(`app-panel.class {\n\t/* top */\n\t> header {\n\t\t> `),
		).toContain(`button`)
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

	it(`qualifies the parent with & at the start of a nested selector`, () => {
		for (const sourceText of [
			`app-panel.class {\n\t`,
			`app-panel.class {\n\t> header {\n\t\t`,
			`app-panel.class {\n\t> header, `,
		]) {
			const completionLabels = labels(sourceText)

			expect(completionLabels).toEqual(
				expect.arrayContaining([
					`&:hover`,
					`&:focus-visible`,
					`&::before`,
					`&::after`,
				]),
			)
			expect(completionLabels).not.toContain(`:hover`)
			expect(completionLabels).not.toContain(`::before`)
		}

		expect(completion(`app-panel.class {\n\t`, `&:hover`)?.insertText).toBe(
			`&:hover`,
		)
	})

	it(`puts & before colons already typed at the start of a nested selector`, () => {
		expect(completion(`app-panel.class {\n\t:`, `&:hover`)).toMatchObject({
			filterText: `:hover`,
			textEdit: {
				newText: `&:hover`,
				range: {
					end: { character: 2, line: 1 },
					start: { character: 1, line: 1 },
				},
			},
		})
		expect(completion(`app-panel.class {\n\t::`, `&::before`)).toMatchObject({
			filterText: `::before`,
			textEdit: {
				newText: `&::before`,
				range: {
					end: { character: 3, line: 1 },
					start: { character: 1, line: 1 },
				},
			},
		})
		expect(labels(`app-panel.class {\n\t::`)).toEqual([`&::after`, `&::before`])
	})

	it(`suggests no pseudo refinement where there is nothing to refine`, () => {
		for (const sourceText of [
			``,
			`app-panel.class `,
			`app-panel.class {\n\t> `,
			`app-panel.class {\n\t> :`,
			`app-panel.class {\n\t> header `,
			`app-panel.class {\n\t& `,
			`app-panel.class {\n\t> :is(`,
			`app-panel.class {\n\t> :is(header, `,
		]) {
			const completionLabels = labels(sourceText)

			expect(completionLabels).toEqual(
				expect.arrayContaining([`:global(...)`, `:is(...)`, `:where(...)`]),
			)
			expect(
				completionLabels.filter((label) =>
					/^&?::?(?:hover|focus-visible|before|after)$/.test(label),
				),
			).toEqual([])
		}
	})

	it(`suggests pseudo refinements for the compound a function is attached to`, () => {
		expect(labels(`app-panel.class {\n\t&:not(`)).toContain(`:hover`)
		expect(labels(`app-panel.class {\n\t> header:is(:hover, `)).toContain(
			`:focus-visible`,
		)
		expect(labels(`app-panel.class {\n\t> :is(header, footer)`)).toContain(
			`::before`,
		)
	})

	it(`suggests only refinements after a colon`, () => {
		expect(labels(`app-panel.class {\n\t> header:`).toSorted()).toEqual(
			[
				`::after`,
				`::before`,
				`:focus-visible`,
				`:global(...)`,
				`:global(.)`,
				`:hover`,
				`:is(...)`,
				`:where(...)`,
			].toSorted(),
		)
	})

	it(`does not suggest unsupported selector constructs`, () => {
		const completionLabels = labels(`app-panel.class {\n\t`)

		expect(completionLabels).not.toContain(`+`)
		expect(completionLabels).not.toContain(`~`)
		expect(completionLabels).not.toContain(`:has(...)`)
		expect(completionLabels).not.toContain(`*`)
	})
})

describe(`lasertag lsp completions and selector-segment-without-tag`, () => {
	const typescriptSession = createTypescriptAstSession()

	afterAll(() => typescriptSession.close())

	function analyze(cssSource: string) {
		return validateCssReachability(
			{
				cssPath: `/project/src/AppPanel.module.css`,
				cssSource,
				tsxPath: `/project/src/AppPanel.tsx`,
				tsxSource: `
import css from "./AppPanel.module.css"

export function AppPanel() {
	return (
		<app-panel class={css.class} data-state="open">
			<header><button type="button" aria-label="Close" /></header>
			<footer><a href="/details" /></footer>
		</app-panel>
	)
}`,
			},
			typescriptSession,
		)
	}

	function accept(sourceText: string, item: CompletionItem): string {
		const typedLine = sourceText.slice(sourceText.lastIndexOf(`\n`) + 1)
		const text = (
			(item.textEdit ? item.textEdit.newText : item.insertText) ?? item.label
		)
			.replace(`:global(.$1)`, `:global(.theme)`)
			.replace(`:global($1)`, `:global(.theme)`)
			.replace(`($1)`, `(header)`)

		if (!item.textEdit || !(`range` in item.textEdit)) return sourceText + text

		const replacedLength =
			typedLine.length - item.textEdit.range.start.character

		return sourceText.slice(0, sourceText.length - replacedLength) + text
	}

	it.each([
		[``, ` {}`],
		[`:`, ` {}`],
		[`app-panel.class `, ` {}`],
		[`app-panel.class > `, ` {}`],
		[`app-panel.class {\n\t`, ` {}\n}`],
		[`app-panel.class {\n\t:`, ` {}\n}`],
		[`app-panel.class {\n\t::`, ` {}\n}`],
		[`app-panel.class {\n\t/* note */\n\t:`, ` {}\n}`],
		[`app-panel.class {\n\t> `, ` {}\n}`],
		[`app-panel.class {\n\t> :`, ` {}\n}`],
		[`app-panel.class {\n\t> header`, ` {}\n}`],
		[`app-panel.class {\n\t> header:`, ` {}\n}`],
		[`app-panel.class {\n\t> header `, ` {}\n}`],
		[`app-panel.class {\n\t> header, `, ` {}\n}`],
		[`app-panel.class {\n\t&:`, ` {}\n}`],
		[`app-panel.class {\n\t& `, ` {}\n}`],
		[`app-panel.class {\n\t&:not(`, `) {}\n}`],
		[`app-panel.class {\n\t> :is(`, `) {}\n}`],
		[`app-panel.class {\n\t> :is(header, `, `) {}\n}`],
		[`app-panel.class {\n\t> header {\n\t\t`, ` {}\n\t}\n}`],
		[`app-panel.class {\n\t> header {\n\t\t:`, ` {}\n\t}\n}`],
		[`@media (hover: hover) {\n\t`, ` {}\n}`],
	])(
		`completes no segment without a tag after %j`,
		(sourceText, closingText) => {
			const items = createCssModuleCompletionItems({
				offset: sourceText.length,
				renderStory: analyze(`app-panel.class {}`).renderStory,
				sourceText,
			})
			const rejectedLabels = items
				.filter((item) =>
					analyze(accept(sourceText, item) + closingText).diagnostics.some(
						(diagnostic) => diagnostic.code === `selector-segment-without-tag`,
					),
				)
				.map((item) => item.label)

			expect(items.length).toBeGreaterThan(0)
			expect(rejectedLabels).toEqual([])
		},
	)
})
