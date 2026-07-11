import { afterAll, describe, expect, it } from "vitest"

import { createTypescriptAstSession } from "../../src/refractor/typescript-ast.ts"
import { validateCssReachability as validateCssReachabilityOnce } from "../../src/refractor/validate-css-reachability.ts"

const typescriptSession = createTypescriptAstSession()

afterAll(() => typescriptSession.close())

function validateCssReachability(
	options: Parameters<typeof validateCssReachabilityOnce>[0],
) {
	return validateCssReachabilityOnce(options, typescriptSession)
}

function diagnosticCodes(tsxSource: string, cssSource: string): string[] {
	return validateCssReachability({
		tsxPath: `/project/src/AppPanel.tsx`,
		cssPath: `/project/src/AppPanel.module.css`,
		tsxSource,
		cssSource,
	}).diagnostics.map((diagnostic) => diagnostic.code)
}

function diagnosticSelectors(tsxSource: string, cssSource: string): string[] {
	return validateCssReachability({
		tsxPath: `/project/src/AppPanel.tsx`,
		cssPath: `/project/src/AppPanel.module.css`,
		tsxSource,
		cssSource,
	}).diagnostics.map((diagnostic) => diagnostic.selector)
}

describe(`render story css reachability`, () => {
	it(`suppresses diagnostics on the line after a lasertag expect-error directive`, () => {
		expect(
			diagnosticSelectors(
				`export function AppPanel() { return <app-panel><header /></app-panel> }`,
				`app-panel.class {
	/* @lasertag-expect-error: gets appended via useEffect */
	> canvas {}
	> footer {}
}`,
			),
		).toEqual([`app-panel.class > footer`])
	})

	it(`reports an unused lasertag expect-error directive`, () => {
		const cssSource = `app-panel.class {
	/* @lasertag-expect-error: header is conditionally rendered */
	> header {}
}`
		const result = validateCssReachability({
			cssPath: `/project/src/AppPanel.module.css`,
			cssSource,
			tsxPath: `/project/src/AppPanel.tsx`,
			tsxSource: `export function AppPanel() { return <app-panel><header /></app-panel> }`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `unused-expect-error`,
				selector: `/* @lasertag-expect-error: header is conditionally rendered */`,
			},
		])
		expect(
			cssSource.slice(
				result.diagnostics[0]?.range?.start,
				result.diagnostics[0]?.range?.end,
			),
		).toBe(`/* @lasertag-expect-error: header is conditionally rendered */`)
	})

	it(`requires a lasertag expect-error explanation of at least three characters`, () => {
		expect(
			diagnosticCodes(
				`export function AppPanel() { return <app-panel /> }`,
				`app-panel.class {
	/* @lasertag-expect-error: no */
	> footer {}
}`,
			),
		).toEqual([`expect-error-explanation-too-short`])

		expect(
			diagnosticCodes(
				`export function AppPanel() { return <app-panel /> }`,
				`app-panel.class {
	/* @lasertag-expect-error: yep */
	> footer {}
}`,
			),
		).toEqual([])
	})

	it(`targets only the immediately following line`, () => {
		expect(
			diagnosticCodes(
				`export function AppPanel() { return <app-panel /> }`,
				`app-panel.class {
	/* @lasertag-expect-error: rendered by a portal */

	> footer {}
}`,
			),
		).toEqual([`unused-expect-error`, `dead-selector`])
	})

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

describe(`module.css dead code assessment`, () => {
	it(`reports an unreachable root selector for a component that always renders one tag`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class} />
					}
				`,
				`
					app-panel.class {}
					other-panel.class {}
				`,
			),
		).toEqual([`other-panel.class`])
	})

	it(`reports a dead direct child for a root with one stable child`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> header {}
						> footer {}
					}
				`,
			),
		).toEqual([`app-panel.class > footer`])
	})

	it(`checks selector-list entries independently`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class > header,
					app-panel.class > aside {}
				`,
			),
		).toEqual([`app-panel.class > aside`])
	})

	it(`expands ampersand nesting before checking selector reachability`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						& > header {}
						& > nav {}
					}
				`,
			),
		).toEqual([`app-panel.class > nav`])
	})

	it(`checks nested rules inside at-rules`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<section />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						@media (width >= 48rem) {
							> section {}
							> nav {}
						}
					}
				`,
			),
		).toEqual([`app-panel.class > nav`])
	})

	it(`treats fragments as transparent and null branches as empty`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel({ open }: { open: boolean }) {
						if (!open) return null

						return (
							<>
								<app-panel className={css.class}>
									<dialog-body />
								</app-panel>
							</>
						)
					}
				`,
				`
					app-panel.class {
						> dialog-body {}
						> dialog-footer {}
					}
				`,
			),
		).toEqual([`app-panel.class > dialog-footer`])
	})

	it(`treats logical-and branches as reachable alternate paths`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel({ expanded }: { expanded: boolean }) {
						return (
							<app-panel className={css.class}>
								{expanded && (
									<details-panel>
										<button type="button" />
									</details-panel>
								)}
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> details-panel {
							> button {}
						}

						> summary-panel {}
					}
				`,
			),
		).toEqual([`app-panel.class > summary-panel`])
	})

	it(`handles map callbacks with block bodies and null returns`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel({ items }: { items: Array<string | null> }) {
						return (
							<app-panel className={css.class}>
								{items.map((item) => {
									if (!item) return null

									return (
										<item-row>
											<span>{item}</span>
										</item-row>
									)
								})}
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> item-row {
							> span {}
							> button {}
						}
					}
				`,
			),
		).toEqual([`app-panel.class > item-row > button`])
	})

	it(`inlines same-file components wrapped in common component factories`, () => {
		expect(
			diagnosticSelectors(
				`
					import * as React from "react"
					import css from "./AppPanel.module.css"

					const Toolbar = React.memo(() => (
						<toolbar-row>
							<button type="button" />
						</toolbar-row>
					))

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<Toolbar />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> toolbar-row {
							> button {}
							> a {}
						}
					}
				`,
			),
		).toEqual([`app-panel.class > toolbar-row > a`])
	})

	it(`handles a multi-component render story with nested conditionals and maps`, () => {
		const result = validateCssReachability({
			tsxPath: `/project/src/DashboardPanel.tsx`,
			cssPath: `/project/src/DashboardPanel.module.css`,
			tsxSource: `
				import css from "./DashboardPanel.module.css"

				type Item = {
					disabled?: boolean
					href: string
					label: string
				}

				function PanelHeader({ dense }: { dense: boolean }) {
					return (
						<panel-header>
							{dense ? (
								<compact-actions>
									<button type="button" />
								</compact-actions>
							) : (
								<wide-actions>
									<button type="button" />
									<a href="/settings">Settings</a>
								</wide-actions>
							)}
						</panel-header>
					)
				}

				function PanelBody(
					{ items, mode }: { items: Item[]; mode: "empty" | "ready" },
				) {
					if (mode === "empty") {
						return (
							<empty-state>
								<p />
							</empty-state>
						)
					}

					return (
						<content-list>
							{items.map((item) =>
								item.disabled ? (
									<disabled-row>
										<span>{item.label}</span>
									</disabled-row>
								) : (
									<active-row>
										<a href={item.href}>{item.label}</a>
									</active-row>
								)
							)}
						</content-list>
					)
				}

				function PanelFooter() {
					return (
						<panel-footer>
							<small />
						</panel-footer>
					)
				}

				export function DashboardPanel(
					props: {
						dense: boolean
						items: Item[]
						mode: "empty" | "ready"
						ready: boolean
						showFooter: boolean
					},
				) {
					return (
						<dashboard-panel className={css.class}>
							{props.ready ? (
								<>
									<PanelHeader dense={props.dense} />
									<PanelBody items={props.items} mode={props.mode} />
								</>
							) : (
								<loading-state />
							)}
							{props.showFooter && <PanelFooter />}
						</dashboard-panel>
					)
				}
			`,
			cssSource: `
				dashboard-panel.class {
					> panel-header {
						> compact-actions {
							> button {}
						}

						> wide-actions {
							> button {}
							> a {}
						}

						> search-box {}
					}

					> empty-state {
						> p {}
					}

					> content-list {
						> active-row {
							> a {}
						}

						> disabled-row {
							> span {}
						}

						> archived-row {}
					}

					> loading-state {}

					> panel-footer {
						> small {}
						> button {}
					}

					> error-state {}
				}
			`,
		})

		expect(result.diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				selector: `dashboard-panel.class > panel-header > search-box`,
			},
			{
				code: `dead-selector`,
				selector: `dashboard-panel.class > content-list > archived-row`,
			},
			{
				code: `dead-selector`,
				selector: `dashboard-panel.class > panel-footer > button`,
			},
			{
				code: `dead-selector`,
				selector: `dashboard-panel.class > error-state`,
			},
		])
	})
})

describe(`module.css pseudo selector reachability`, () => {
	it(`allows ampersand pseudo-classes on the owning selector`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						&:hover {}
						&:focus-visible {
							> header {}
						}
					}
				`,
			),
		).toEqual([])
	})

	it(`checks selectors nested underneath ampersand pseudo-classes`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header>
									<h1 />
								</header>
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						&:focus-visible {
							> header {
								> h1 {}
								> nav {}
							}
						}
					}
				`,
			),
		).toEqual([`app-panel.class:focus-visible > header > nav`])
	})

	it(`allows ampersand pseudo-elements on the owning selector`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class} />
					}
				`,
				`
					app-panel.class {
						&::before {}
						&::after {}
					}
				`,
			),
		).toEqual([])
	})

	it(`checks selectors nested underneath ampersand pseudo-elements`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header>
									<h1 />
								</header>
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						&::before {
							> header {
								> h1 {}
								> button {}
							}
						}
					}
				`,
			),
		).toEqual([`app-panel.class::before > header > button`])
	})
})

describe(`module.css selector refinement reachability`, () => {
	it(`treats non-structural functional pseudo-classes as host refinements`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<button type="button" />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> button:not(.disabled):nth-child(1) {}
						> a:not(.disabled) {}
					}
				`,
			),
		).toEqual([`app-panel.class > a:not(.disabled)`])
	})

	it(`treats :is tag arguments as structural alternatives`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header>
									<h1 />
								</header>
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> :is(header, footer) {
							> h1 {}
							> nav {}
						}
					}
				`,
			),
		).toEqual([`app-panel.class > :is(header, footer) > nav`])
	})

	it(`treats :where tag arguments as structural alternatives`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> :where(header, footer) {}
						> :where(nav, aside) {}
					}
				`,
			),
		).toEqual([`app-panel.class > :where(nav, aside)`])
	})

	it(`treats attribute selectors as host refinements`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<button type="button" data-icon=".external" />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> button[type="button"][data-icon=".external"] {}
						> a[href] {}
					}
				`,
			),
		).toEqual([`app-panel.class > a[href]`])
	})
})

describe(`module.css selector unknowns and escapes`, () => {
	it(`skips selectors that cross a :global escape hatch`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class} />
					}
				`,
				`
					app-panel.class {
						:global(.radix-popover-content) {
							> button {}
						}
					}
				`,
			),
		).toEqual([])
	})

	it(`skips wildcard and tagless selectors`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class} />
					}
				`,
				`
					app-panel.class {
						> * {}
						> [role="button"] {}
					}
				`,
			),
		).toEqual([])
	})

	it(`skips unsupported structural selectors`, () => {
		expect(
			diagnosticSelectors(
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
						> header ~ footer {}
						> header:has(button) {}
						svg|a {}
					}
				`,
			),
		).toEqual([])
	})
})

describe(`module.css nesting and at-rule reachability`, () => {
	it(`checks multiple root selector alternatives independently`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class,
					other-panel.class {
						> header {}
					}
				`,
			),
		).toEqual([`other-panel.class`, `other-panel.class > header`])
	})

	it(`checks nested rules inside modern at-rules`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					@supports (container-type: inline-size) {
						app-panel.class {
							@container (width > 20rem) {
								@layer components {
									> header {}
									> footer {}
								}
							}
						}
					}
				`,
			),
		).toEqual([`app-panel.class > footer`])
	})

	it(`reports nested self class selectors as impossible local classes`, () => {
		expect(
			diagnosticCodes(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<app-panel />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						& & {}
					}
				`,
			),
		).toEqual([`impossible-local-class`])
	})

	it(`allows ampersand root alternatives inside :is`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						:is(&, other-panel.class) {
							> header {}
							> footer {}
						}
					}
				`,
			),
		).toEqual([`:is(app-panel.class, other-panel.class) > footer`])
	})
})

describe(`module.css opaque render story boundaries`, () => {
	it(`does not report descendants that may come from imported components`, () => {
		expect(
			diagnosticSelectors(
				`
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
				`
					app-panel.class {
						> button {}
						button {}
					}
				`,
			),
		).toEqual([])
	})

	it(`does not report descendants that may come from children`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel({ children }: { children: React.ReactNode }) {
						return (
							<app-panel className={css.class}>
								{children}
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> button {}
						button {}
					}
				`,
			),
		).toEqual([])
	})

	it(`does not report descendants that may come from render prop calls`, () => {
		expect(
			diagnosticSelectors(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel(
						props: { footer?: () => React.ReactNode },
					) {
						return (
							<app-panel className={css.class}>
								{props.footer?.()}
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> footer {}
						footer button {}
					}
				`,
			),
		).toEqual([])
	})

	it(`does not report descendants that may come from portal calls`, () => {
		expect(
			diagnosticSelectors(
				`
					import { createPortal } from "react-dom"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								{createPortal(<footer />, document.body)}
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> footer {}
						footer button {}
					}
				`,
			),
		).toEqual([])
	})
})
