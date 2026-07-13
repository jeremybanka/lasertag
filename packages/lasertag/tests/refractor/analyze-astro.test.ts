import { describe, expect, it } from "vitest"

import {
	analyzeAstroRenderStory,
	validateRenderSourceCssReachability,
} from "../../src/refractor/index.ts"

describe(`Astro render story extraction`, () => {
	it(`extracts native and custom element structure from an Astro template`, () => {
		const story = analyzeAstroRenderStory({
			filePath: `/project/src/AppPanel.astro`,
			sourceText: `---
import Card from "./Card.astro"
---
<app-panel class={css.class}>
	<header />
	{enabled ? <enabled-state><span /></enabled-state> : null}
	<Card />
</app-panel>`,
		})

		expect(story).toMatchObject({
			componentName: `AppPanel`,
			roots: [
				{
					children: [
						{ kind: `element`, tagName: `header` },
						{
							children: [{ kind: `element`, tagName: `span` }],
							kind: `element`,
							tagName: `enabled-state`,
						},
						{
							children: [
								{
									kind: `opaque`,
									reason: `Astro component "Card" implementation`,
								},
							],
							kind: `element`,
							tagName: `card`,
						},
					],
					kind: `element`,
					tagName: `app-panel`,
				},
			],
			warnings: [],
		})
	})

	it(`selects the CSS attachment beneath a transparent layout as the root`, () => {
		const sourceText = `---
import Layout from "../layouts/Layout.astro"
import { Dz2Orbital } from "../components/Dz2Orbital"
import css from "./index.module.css"
---

<Layout>
	<Dz2Orbital data-variant="splash" client:only />
	<home-splash class={css.class}>
		<title-lockup><h1>Atom</h1></title-lockup>
	</home-splash>
</Layout>`
		const story = analyzeAstroRenderStory({ sourceText })

		expect(story.roots).toMatchObject([
			{
				attributes: [{ expression: `css.class`, name: `class` }],
				children: [
					{
						children: [{ kind: `element`, tagName: `h1` }],
						kind: `element`,
						tagName: `title-lockup`,
					},
				],
				kind: `element`,
				tagName: `home-splash`,
			},
		])

		const result = validateRenderSourceCssReachability({
			cssSource: `home-splash.class {
	> title-lockup {}
	> definitely-bogus {}
}`,
			sourcePath: `/project/src/pages/index.astro`,
			sourceText,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `home-splash.class > definitely-bogus`,
			},
		])
	})

	it(`validates CSS reachability against an Astro source`, () => {
		const result = validateRenderSourceCssReachability({
			cssSource: `app-panel.class {
	> header {}
	> footer {}
}`,
			sourcePath: `/project/src/AppPanel.astro`,
			sourceText: `<app-panel class={css.class}><header /></app-panel>`,
		})

		expect(result.diagnostics).toMatchObject([
			{ code: `dead-selector`, selector: `app-panel.class > footer` },
		])
	})

	it(`treats slots and unknown expressions as opaque render branches`, () => {
		const story = analyzeAstroRenderStory({
			sourceText: `<app-panel><slot />{content}</app-panel>`,
		})

		expect(story.roots[0]).toMatchObject({
			children: [
				{ kind: `opaque`, reason: `slot render branch` },
				{
					kind: `opaque`,
					reason: `unknown Astro expression render branch`,
				},
			],
			kind: `element`,
			tagName: `app-panel`,
		})
	})
})
