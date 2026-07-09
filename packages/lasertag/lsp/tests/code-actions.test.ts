import { describe, expect, it } from "vitest"

import {
	createDeadSelectorCleanupRanges,
	type OffsetRange,
} from "../../src/lsp/code-actions.ts"

function applyRanges(sourceText: string, ranges: OffsetRange[]): string {
	return [...ranges]
		.sort((left, right) => right.start - left.start)
		.reduce(
			(text, range) => `${text.slice(0, range.start)}${text.slice(range.end)}`,
			sourceText,
		)
}

function rangeFor(sourceText: string, selector: string): OffsetRange {
	const start = sourceText.indexOf(selector)

	if (start === -1) throw new Error(`Missing selector: ${selector}`)

	return { end: start + selector.length, start }
}

describe(`lasertag lsp code actions`, () => {
	it(`removes a whole dead nested selector rule`, () => {
		const sourceText = `app-root.class {
\t> p {
\t\tdisplay: block;
\t}
\t> span {
\t\tdisplay: inline;
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `> p`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {
\t> span {
\t\tdisplay: inline;
\t}
}
`)
	})

	it(`removes the first selector from a selector list`, () => {
		const sourceText = `app-root.class {
\t> p, > span {
\t\tdisplay: block;
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `> p`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {
\t> span {
\t\tdisplay: block;
\t}
}
`)
	})

	it(`removes the last selector from a selector list`, () => {
		const sourceText = `app-root.class {
\t> p, > span {
\t\tdisplay: block;
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `> span`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {
\t> p {
\t\tdisplay: block;
\t}
}
`)
	})

	it(`removes a whole selector-list rule when every selector is dead`, () => {
		const sourceText = `app-root.class {
\t> p, > span {
\t\tdisplay: block;
\t}
\t> strong {
\t\tfont-weight: 700;
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `> p`),
			rangeFor(sourceText, `> span`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {
\t> strong {
\t\tfont-weight: 700;
\t}
}
`)
	})

	it(`preserves the parent closing line when removing the final nested rule`, () => {
		const sourceText = `app-root.class {
\t> p {
\t\tdisplay: block;
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `> p`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {

}
`)
	})

	it(`does not remove the end of a block comment before a dead selector`, () => {
		const sourceText = `app-root.class {
\tdisplay: grid;
\tgap: 0.5rem;
\t/* > hello-world {
\t\tdisplay: float;
\t} */
\thi {
\t}
}
`
		const ranges = createDeadSelectorCleanupRanges(sourceText, [
			rangeFor(sourceText, `hi`),
		])

		expect(applyRanges(sourceText, ranges)).toBe(`app-root.class {
\tdisplay: grid;
\tgap: 0.5rem;
\t/* > hello-world {
\t\tdisplay: float;
\t} */

}
`)
	})
})
