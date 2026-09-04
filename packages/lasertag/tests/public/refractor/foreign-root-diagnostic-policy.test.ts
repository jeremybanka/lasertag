import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vite-plus/test"

import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import { validateCssReachability as validateCssReachabilityOnce } from "../../../src/refractor/validate-css-reachability.ts"

const typescriptSession = createTypescriptAstSession()
const projectRoot = mkdtempSync(path.join(tmpdir(), `lasertag-foreign-roots-`))
const sourceRoot = path.join(projectRoot, `src`)

mkdirSync(sourceRoot, { recursive: true })
writeFileSync(
	path.join(sourceRoot, `Dialog.tsx`),
	`export function Dialog() { return <dialog><form /></dialog> }`,
)
writeFileSync(
	path.join(sourceRoot, `NamedDialog.tsx`),
	`export function NamedDialog() { return <section><form /></section> }`,
)
writeFileSync(
	path.join(sourceRoot, `ComputedDialog.tsx`),
	`export function ComputedDialog() { return createElement("section") }`,
)
const changingDialogPath = path.join(sourceRoot, `ChangingDialog.tsx`)

writeFileSync(
	changingDialogPath,
	`export function ChangingDialog() { return <section /> }`,
)

const libraryRoot = path.join(projectRoot, `node_modules`, `library-components`)

mkdirSync(path.join(libraryRoot, `src`), { recursive: true })
writeFileSync(
	path.join(libraryRoot, `package.json`),
	JSON.stringify({
		name: `library-components`,
		type: `module`,
		exports: `./src/index.tsx`,
	}),
)
writeFileSync(
	path.join(libraryRoot, `src`, `index.tsx`),
	`export { Dialog as LibraryDialog } from "./Dialog.tsx"`,
)
writeFileSync(
	path.join(libraryRoot, `src`, `Dialog.tsx`),
	`export function Dialog() { return <section><form /></section> }`,
)

const declarationsOnlyRoot = path.join(
	projectRoot,
	`node_modules`,
	`declarations-only-components`,
)

mkdirSync(declarationsOnlyRoot, { recursive: true })
writeFileSync(
	path.join(declarationsOnlyRoot, `package.json`),
	JSON.stringify({
		name: `declarations-only-components`,
		type: `module`,
		exports: {
			types: `./index.d.ts`,
			default: `./index.js`,
		},
	}),
)
writeFileSync(
	path.join(declarationsOnlyRoot, `index.d.ts`),
	`export declare function LibraryDialog(): unknown`,
)
writeFileSync(
	path.join(declarationsOnlyRoot, `index.js`),
	`export function LibraryDialog() { return null }`,
)

afterAll(() => {
	typescriptSession.close()
	rmSync(projectRoot, { force: true, recursive: true })
})

function diagnosticDetails(tsxSource: string, cssSource: string) {
	return validateCssReachabilityOnce(
		{
			cssPath: path.join(sourceRoot, `AppPanel.module.css`),
			cssSource,
			tsxPath: path.join(sourceRoot, `AppPanel.tsx`),
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

	it(`does not infer a relative component root from its exported name`, () => {
		expect(
			diagnosticDetails(
				`
					import { NamedDialog } from "./NamedDialog.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<named-dialog />
								<NamedDialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> named-dialog {}
						> section {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-matches-foreign-component-root`,
				message: `Selector "app-panel.class > section" matches <section>, the root rendered by foreign component NamedDialog. Use <section.NamedDialog /> to explicitly opt into styling this root.`,
				selector: `app-panel.class > section`,
			},
		])
	})

	it(`resolves a library export instead of inferring a root from its name`, () => {
		expect(
			diagnosticDetails(
				`
					import { LibraryDialog } from "library-components"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<LibraryDialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> section {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-matches-foreign-component-root`,
				message: `Selector "app-panel.class > section" matches <section>, the root rendered by foreign component LibraryDialog. Use <section.LibraryDialog /> to explicitly opt into styling this root.`,
				selector: `app-panel.class > section`,
			},
		])
	})

	it(`keeps a declaration-only library component opaque`, () => {
		expect(
			diagnosticDetails(
				`
					import { LibraryDialog } from "declarations-only-components"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<LibraryDialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> section {}
					}
				`,
			),
		).toEqual([
			{
				code: `opaque-component-root-may-collide`,
				message: `Cannot verify ownership of "app-panel.class > section": LibraryDialog has an unknown rendered root and may also render <section>. Declare its stable intrinsic root with <tag.LibraryDialog /> or place it beneath an owned boundary.`,
				selector: `app-panel.class > section`,
			},
		])
	})

	it(`keeps a resolved but unsupported implementation opaque`, () => {
		expect(
			diagnosticDetails(
				`
					import { ComputedDialog } from "./ComputedDialog.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<ComputedDialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> section {}
					}
				`,
			),
		).toEqual([
			{
				code: `opaque-component-root-may-collide`,
				message: `Cannot verify ownership of "app-panel.class > section": ComputedDialog has an unknown rendered root and may also render <section>. Declare its stable intrinsic root with <tag.ComputedDialog /> or place it beneath an owned boundary.`,
				selector: `app-panel.class > section`,
			},
		])
	})

	it(`refreshes a resolved implementation after its module changes`, () => {
		const tsxSource = `
			import { ChangingDialog } from "./ChangingDialog.tsx"
			import css from "./AppPanel.module.css"

			export function AppPanel() {
				return <app-panel className={css.class}><ChangingDialog /></app-panel>
			}
		`

		expect(
			diagnosticDetails(tsxSource, `app-panel.class { > section {} }`),
		).toMatchObject([
			{
				code: `selector-matches-foreign-component-root`,
				selector: `app-panel.class > section`,
			},
		])

		writeFileSync(
			changingDialogPath,
			`export function ChangingDialog() { return <aside /> }`,
		)

		expect(
			diagnosticDetails(tsxSource, `app-panel.class { > aside {} }`),
		).toMatchObject([
			{
				code: `selector-matches-foreign-component-root`,
				selector: `app-panel.class > aside`,
			},
		])
	})

	it(`resolves a component imported through a module namespace`, () => {
		expect(
			diagnosticDetails(
				`
					import * as Library from "library-components"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<Library.LibraryDialog />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> section {}
					}
				`,
			),
		).toEqual([
			{
				code: `selector-matches-foreign-component-root`,
				message: `Selector "app-panel.class > section" matches <section>, the root rendered by foreign component LibraryDialog. Use <section.LibraryDialog /> to explicitly opt into styling this root.`,
				selector: `app-panel.class > section`,
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
