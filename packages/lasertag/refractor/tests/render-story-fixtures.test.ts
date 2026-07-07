import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
	analyzeTsxRenderStories,
	analyzeTsxRenderStory,
} from "../src/analyze-tsx.ts"

const fixturesRoot = fileURLToPath(new URL(`fixtures/golden`, import.meta.url))

function fixtureNames(): string[] {
	return readdirSync(fixturesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right))
}

function stripSourceRanges(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stripSourceRanges)
	}

	if (!value || typeof value !== `object`) {
		return value
	}

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== `range`)
			.map(([key, nestedValue]) => [key, stripSourceRanges(nestedValue)]),
	)
}

describe(`golden render story fixtures`, () => {
	for (const fixtureName of fixtureNames()) {
		it(`extracts ${fixtureName}`, () => {
			const fixtureRoot = path.join(fixturesRoot, fixtureName)
			const tsxFixturePath = path.join(fixtureRoot, `component.tsx.fixture`)
			const tsxSource = readFileSync(tsxFixturePath, `utf8`)
			const expected = JSON.parse(
				readFileSync(path.join(fixtureRoot, `expected-story.json`), `utf8`),
			)

			expect(
				stripSourceRanges(
					analyzeTsxRenderStory({
						filePath: path.join(fixtureRoot, `component.tsx`),
						sourceText: tsxSource,
					}),
				),
			).toEqual(expected)
		})
	}
})

describe(`broad render story extraction`, () => {
	it(`extracts every component-style function it can find`, () => {
		const sourceText = `
			import * as React from "react"

			function LocalOnly() {
				return <local-only />
			}

			const Wrapped = React.forwardRef(function WrappedImpl(_props, ref) {
				return (
					<wrapped-root ref={ref}>
						<button type="button" />
					</wrapped-root>
				)
			})

			function plainHelper() {
				return <plain-helper />
			}

			function NotAComponent() {
				return 1
			}

			export function Alpha() {
				return (
					<alpha-root>
						<LocalOnly />
					</alpha-root>
				)
			}

			export const Beta = () => <beta-root />
		`

		expect(
			stripSourceRanges(
				analyzeTsxRenderStories({
					filePath: `/project/src/ManyThings.tsx`,
					sourceText,
				}),
			),
		).toEqual([
			{
				componentName: `LocalOnly`,
				roots: [{ kind: `element`, tagName: `local-only`, children: [] }],
				warnings: [],
			},
			{
				componentName: `Wrapped`,
				roots: [
					{
						kind: `element`,
						tagName: `wrapped-root`,
						children: [{ kind: `element`, tagName: `button`, children: [] }],
					},
				],
				warnings: [],
			},
			{
				componentName: `Alpha`,
				roots: [
					{
						kind: `element`,
						tagName: `alpha-root`,
						children: [
							{ kind: `element`, tagName: `local-only`, children: [] },
						],
					},
				],
				warnings: [],
			},
			{
				componentName: `Beta`,
				roots: [{ kind: `element`, tagName: `beta-root`, children: [] }],
				warnings: [],
			},
		])
	})
})
