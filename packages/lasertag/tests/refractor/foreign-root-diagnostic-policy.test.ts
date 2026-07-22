import { afterAll, describe, expect, it } from "vitest"

import { createTypescriptAstSession } from "../../src/refractor/typescript-ast.ts"
import { validateCssReachability as validateCssReachabilityOnce } from "../../src/refractor/validate-css-reachability.ts"

const typescriptSession = createTypescriptAstSession()

afterAll(() => typescriptSession.close())

function diagnosticDetails(tsxSource: string, cssSource: string) {
	return validateCssReachabilityOnce(
		{
			cssPath: `/project/src/AppPanel.module.css`,
			cssSource,
			tsxPath: `/project/src/AppPanel.tsx`,
			tsxSource,
		},
		typescriptSession,
	).diagnostics.map((diagnostic) => ({
		code: String(diagnostic.code),
		message: diagnostic.message,
		selector: diagnostic.selector,
	}))
}

describe(`foreign component root diagnostic policy`, () => {
	it(`allows a local selector that cannot match a resolved foreign root`, () => {
		expect(
			diagnosticDetails(
				`
					import { Dialog } from "./Dialog.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<header />
								<Dialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> header {}
					}
				`,
			),
		).toEqual([])
	})

	it(`groups an opaque component's possible collision at the first uncertain root`, () => {
		expect(
			diagnosticDetails(
				`
					import { External } from "external-package"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<file-name>
									<button type="button">
										<svg />
									</button>
								</file-name>
								<External />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> file-name {
							> button {
								> svg {}
								&:hover::before {}
							}
						}
					}
				`,
			),
		).toEqual([
			{
				code: `opaque-component-root-may-collide`,
				message: `Cannot verify ownership of selectors beginning at "app-panel.class > file-name": External has an unknown rendered root and may also render <file-name>. This affects 4 selectors. Declare its stable intrinsic root with <tag.External /> or place it beneath an owned boundary.`,
				selector: `app-panel.class > file-name`,
			},
		])
	})

	it(`reports a verified foreign-root collision distinctly and strongly`, () => {
		expect(
			diagnosticDetails(
				`
					import { Dialog } from "./Dialog.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<dialog />
								<Dialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> dialog {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-matches-foreign-component-root`,
				message: `Selector "app-panel.class > dialog" matches <dialog>, the root rendered by foreign component Dialog. Use <dialog.Dialog /> to explicitly opt into styling this root.`,
				selector: `app-panel.class > dialog`,
			},
		])
	})

	it(`allows an asserted foreign root but still reports selectors that enter it`, () => {
		expect(
			diagnosticDetails(
				`
					import { Dialog } from "./Dialog.tsx"
					import css from "./AppPanel.module.css"

					const dialog = { Dialog }

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<dialog.Dialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> dialog {}
						> dialog > form {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-crosses-ownership-boundary`,
				message: `Selector "app-panel.class > dialog > form" crosses into DOM owned by foreign component Dialog beneath its asserted <dialog> root.`,
				selector: `app-panel.class > dialog > form`,
			},
		])
	})

	it(`reports distinct diagnostics when verified and opaque components can both collide`, () => {
		expect(
			diagnosticDetails(
				`
					import { External } from "external-package"
					import { Dialog } from "./Dialog.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<dialog />
								<Dialog />
								<External />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> dialog {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-matches-foreign-component-root`,
				message: `Selector "app-panel.class > dialog" matches <dialog>, the root rendered by foreign component Dialog. Use <dialog.Dialog /> to explicitly opt into styling this root.`,
				selector: `app-panel.class > dialog`,
			},
			{
				code: `opaque-component-root-may-collide`,
				message: `Cannot verify ownership of "app-panel.class > dialog": External has an unknown rendered root and may also render <dialog>. Declare its stable intrinsic root with <tag.External /> or place it beneath an owned boundary.`,
				selector: `app-panel.class > dialog`,
			},
		])
	})
})
