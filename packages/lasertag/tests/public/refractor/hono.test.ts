import { afterAll, describe, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"

const session = createTypescriptAstSession()
afterAll(() => session.close())

function analyze(imports: string, children: string, extra = ``) {
	return validateCssReachability(
		{
			tsxPath: `/project/ProjectCard.tsx`,
			cssPath: `/project/ProjectCard.module.css`,
			tsxSource: `${imports}
			import css from "./ProjectCard.module.css"
			${extra}
			export async function ProjectCard(props) {
				await props.load()
				return <project-card class={css.class}>${children}</project-card>
			}`,
			cssSource: `project-card.class {
			> report-list {}
			> loading-state {}
			> error-state {}
			> missing-state {}
		}`,
		},
		session,
	)
}

function deadSelectors(result: ReturnType<typeof analyze>) {
	return result.diagnostics
		.filter((diagnostic) => diagnostic.code === `dead-selector`)
		.map((diagnostic) => diagnostic.selector)
}

describe(`Hono JSX reachability`, () => {
	it.each([
		[`import { Fragment } from "hono/jsx"`, `Fragment`],
		[`import { Fragment as Group } from "hono/jsx"`, `Group`],
		[`import * as Hono from "hono/jsx"`, `Hono.Fragment`],
		[`import Hono from "hono/jsx"`, `Hono.Fragment`],
		[`import { StrictMode as Group } from "hono/jsx"`, `Group`],
		[`import { Fragment as Group } from "hono/jsx/dom"`, `Group`],
	])(`analyzes async components with %s`, (imports, tag) => {
		const result = analyze(
			imports,
			`<${tag}><report-list />{props.loading && <loading-state />}</${tag}>`,
		)
		expect(deadSelectors(result)).toEqual([
			`project-card.class > error-state`,
			`project-card.class > missing-state`,
		])
		expect(result.renderStory.warnings).toEqual([])
	})

	it(`supports explicit fragment children and empty fragments`, () => {
		const result = analyze(
			`import { Fragment } from "hono/jsx"`,
			`<Fragment children={<report-list />} /><Fragment />`,
		)
		expect(deadSelectors(result)).toEqual([
			`project-card.class > loading-state`,
			`project-card.class > error-state`,
			`project-card.class > missing-state`,
		])
	})

	it.each([
		[`import { Suspense } from "hono/jsx/streaming"`, `Suspense`],
		[`import { Suspense as Pending } from "hono/jsx/streaming"`, `Pending`],
		[`import * as Streaming from "hono/jsx/streaming"`, `Streaming.Suspense`],
		[`import { Suspense } from "hono/jsx"`, `Suspense`],
		[`import Hono from "hono/jsx"`, `Hono.Suspense`],
		[`import { Suspense } from "hono/jsx/dom"`, `Suspense`],
	])(`preserves resolved and fallback content with %s`, (imports, tag) => {
		const result = analyze(
			imports,
			`<${tag} fallback={<loading-state />}><LocalReports /></${tag}>`,
			`async function LocalReports() {
				await Promise.resolve()
				return <report-list />
			}`,
		)
		expect(deadSelectors(result)).toEqual([
			`project-card.class > error-state`,
			`project-card.class > missing-state`,
		])
	})

	it.each([
		`fallback={<error-state />}`,
		`fallbackRender={(error) => <error-state>{error.message}</error-state>}`,
	])(`preserves Hono ErrorBoundary %s`, (fallback) => {
		const result = analyze(
			`import { ErrorBoundary as Boundary } from "hono/jsx"`,
			`<Boundary ${fallback}><report-list /></Boundary>`,
		)
		expect(deadSelectors(result)).toEqual([
			`project-card.class > loading-state`,
			`project-card.class > missing-state`,
		])
	})

	it(`keeps dynamic fallbacks and spread props uncertain`, () => {
		for (const attributes of [`fallback={props.fallback}`, `{...props}`]) {
			const result = analyze(
				`import { Suspense } from "hono/jsx/streaming"`,
				`<Suspense ${attributes}><report-list /></Suspense>`,
			)
			expect(deadSelectors(result)).toEqual([])
		}
	})

	it(`preserves ownership boundaries inside Hono wrappers`, () => {
		const result = analyze(
			`import { Fragment, Suspense } from "hono/jsx"
			import { ReportList } from "./ReportList"`,
			`<Fragment><Suspense fallback={<loading-state />}><ReportList /></Suspense></Fragment>`,
		)
		expect(deadSelectors(result)).toEqual([])
		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.code === `opaque-component-root-may-collide`,
			),
		).toBe(true)
	})

	it(`does not assign Hono semantics to similarly named imports`, () => {
		const result = analyze(
			`import { Suspense, Fragment as Group } from "other-library"`,
			`<Group><Suspense fallback={<loading-state />}><report-list /></Suspense></Group>`,
		)
		expect(deadSelectors(result)).toEqual([])
	})

	it(`does not assign Hono semantics to local boundaries`, () => {
		const result = analyze(
			``,
			`<Suspense fallback={<loading-state />}><report-list /></Suspense>`,
			`function Suspense() { return <error-state /> }`,
		)
		expect(deadSelectors(result)).toEqual([
			`project-card.class > report-list`,
			`project-card.class > loading-state`,
			`project-card.class > missing-state`,
		])
	})
})
