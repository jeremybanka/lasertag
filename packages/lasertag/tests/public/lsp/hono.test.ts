import { expect, it } from "vite-plus/test"

import { createDeadSelectorCleanupRanges } from "../../../src/lsp/code-actions.ts"
import { createCssModuleCompletionItems } from "../../../src/lsp/completions.ts"
import { validateCssReachability } from "../../../src/refractor/index.ts"
import {
	cleanedHonoCssSource,
	honoCssSource,
	honoTsxSource,
} from "../fixtures/hono.ts"

it(`completes both Hono Suspense branches and cleans only unreachable selectors`, () => {
	const { renderStory, diagnostics } = validateCssReachability({
		tsxPath: `/project/ProjectCard.tsx`,
		tsxSource: honoTsxSource,
		cssPath: `/project/ProjectCard.module.css`,
		cssSource: honoCssSource,
	})
	const sourceText = `project-card.class {\n\t> `
	const completions = createCssModuleCompletionItems({
		renderStory,
		sourceText,
		offset: sourceText.length,
	})
	expect(completions.map((item) => item.label)).toEqual(
		expect.arrayContaining([`report-list`, `loading-state`]),
	)
	expect(diagnostics).toHaveLength(1)
	expect(diagnostics[0]).toMatchObject({
		code: `dead-selector`,
		selector: `project-card.class > obsolete-state`,
	})
	const ranges = createDeadSelectorCleanupRanges(
		honoCssSource,
		diagnostics.flatMap((diagnostic) =>
			diagnostic.range ? [diagnostic.range] : [],
		),
	)
	const cleaned = ranges
		.toSorted((left, right) => right.start - left.start)
		.reduce(
			(text, range) => text.slice(0, range.start) + text.slice(range.end),
			honoCssSource,
		)
	expect(cleaned).toBe(cleanedHonoCssSource)
})
