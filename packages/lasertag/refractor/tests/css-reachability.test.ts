import { describe, expect, it } from "vitest"

import { validateCssReachability } from "../src/validate-css-reachability.ts"

function diagnosticCodes(tsxSource: string, cssSource: string): string[] {
	return validateCssReachability({
		tsxPath: `/project/src/AppPanel.tsx`,
		cssPath: `/project/src/AppPanel.module.css`,
		tsxSource,
		cssSource,
	}).diagnostics.map((diagnostic) => diagnostic.code)
}

describe(`render story css reachability`, () => {
	it(`allows selectors that match direct rendered tag paths`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<header>
								<h1>Project</h1>
							</header>
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> header {
						> h1 {}
					}
				}
			`,
		})

		expect(result.diagnostics).toEqual([])
	})

	it(`reports a dead selector when no render story contains the path`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<header />
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> footer {}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > footer`,
			},
		])
	})

	it(`distinguishes direct-child selectors from descendant selectors`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<section>
								<footer />
							</section>
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> footer {}
					footer {}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > footer`,
			},
		])
	})

	it(`inlines same-file local components into the render story`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				const PanelActions = () => (
					<actions-row>
						<button type="button">Save</button>
					</actions-row>
				)

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<PanelActions />
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> actions-row {
						> button {}
						> a {}
					}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > actions-row > a`,
			},
		])
	})

	it(`treats conditional branches as alternate reachable paths`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel({ showFooter }: { showFooter: boolean }) {
					return (
						<app-panel className={css.class}>
							{showFooter ? <footer /> : <header />}
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> header {}
					> footer {}
				}
			`,
		})

		expect(result.diagnostics).toEqual([])
	})

	it(`treats simple map callback returns as repeated reachable branches`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel({ items }: { items: string[] }) {
					return (
						<app-panel className={css.class}>
							{items.map((item) => <item-row>{item}</item-row>)}
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> item-row {}
					> missing-row {}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `app-panel.class > missing-row`,
			},
		])
	})

	it(`reports nested local classes as impossible under the lasertag module contract`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<label />
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> .label {}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `impossible-local-class`,
				selector: `app-panel.class > .label`,
			},
		])
	})

	it(`does not report dead selectors across opaque imported component branches`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/AppPanel.tsx`,
			cssPath: `/project/src/AppPanel.module.css`,
			tsxSource: `
				import css from "./AppPanel.module.css"
				import { UserMenu } from "./UserMenu.tsx"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<UserMenu />
						</app-panel>
					)
				}
			`,
			cssSource: `
				app-panel.class {
					> user-menu {}
				}
			`,
		})

		expect(result.diagnostics).toEqual([])
	})

	it(`skips unsupported selectors instead of reporting them as dead`, () => {
		expect(
			diagnosticCodes(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
								<footer />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> header + footer {}
					}
				`,
			),
		).toEqual([])
	})
})
