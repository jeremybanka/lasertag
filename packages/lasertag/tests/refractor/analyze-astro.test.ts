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
							kind: `opaque`,
							reason: `imported or external Astro component`,
						},
					],
					kind: `element`,
					tagName: `app-panel`,
				},
			],
			warnings: [],
		})
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
