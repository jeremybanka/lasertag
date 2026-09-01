import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import { validateCssReachability } from "../../../src/refractor/validate-css-reachability.ts"

const projectRoot = mkdtempSync(path.join(tmpdir(), `lasertag-adoption-`))
const sourceRoot = path.join(projectRoot, `src`)
const typescriptSession = createTypescriptAstSession()

mkdirSync(sourceRoot, { recursive: true })
writeFileSync(
	path.join(sourceRoot, `HeadlessEditor.tsx`),
	`
		function EditorSurface() {
			return (
				<headless-editor>
					<editable-region contentEditable="true">
						<caret-layer />
					</editable-region>
				</headless-editor>
			)
		}

		export function HeadlessEditor() {
			return <EditorSurface />
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `NestedToolbar.tsx`),
	`export function NestedToolbar() { return <nested-toolbar><button /></nested-toolbar> }`,
)
writeFileSync(
	path.join(sourceRoot, `ComposedEditor.tsx`),
	`
		import { NestedToolbar } from "./NestedToolbar.tsx"

		export function ComposedEditor() {
			return <composed-editor><NestedToolbar /></composed-editor>
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `SlottedEditor.tsx`),
	`
		export function SlottedEditor(props: { children?: unknown }) {
			return <slotted-editor>{props.children}</slotted-editor>
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `RenderPropEditor.tsx`),
	`
		export function RenderPropEditor(props: { overlay?: () => unknown }) {
			return <render-prop-editor>{props.overlay?.()}</render-prop-editor>
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `PortalEditor.tsx`),
	`
		import { createPortal } from "react-dom"

		export function PortalEditor() {
			return (
				<portal-editor>
					<local-content />
					{createPortal(<portal-content />, document.body)}
				</portal-editor>
			)
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `AssertedEditor.tsx`),
	`
		function Icon() {
			return <svg><path /></svg>
		}

		const svg = { Icon }

		export function AssertedEditor() {
			return <asserted-editor><svg.Icon /></asserted-editor>
		}
	`,
)
writeFileSync(
	path.join(sourceRoot, `PartialEditor.tsx`),
	`
		declare function renderUnknown(): unknown

		export function PartialEditor(props: { ready: boolean }) {
			return props.ready
				? <partial-editor><known-content /></partial-editor>
				: renderUnknown()
		}
	`,
)

const mappedPackageRoot = path.join(
	projectRoot,
	`node_modules`,
	`mapped-components`,
)

mkdirSync(path.join(mappedPackageRoot, `dist`), { recursive: true })
mkdirSync(path.join(mappedPackageRoot, `src`), { recursive: true })
writeFileSync(
	path.join(mappedPackageRoot, `package.json`),
	JSON.stringify({
		exports: {
			".": {
				default: `./dist/index.js`,
				types: `./dist/index.d.ts`,
			},
		},
		name: `mapped-components`,
		type: `module`,
	}),
)
writeFileSync(
	path.join(mappedPackageRoot, `dist`, `index.d.ts`),
	`export declare function MappedEditor(): unknown\n//# sourceMappingURL=index.d.ts.map`,
)
writeFileSync(
	path.join(mappedPackageRoot, `dist`, `index.d.ts.map`),
	JSON.stringify({
		file: `index.d.ts`,
		mappings: ``,
		names: [],
		sources: [`../src/MappedEditor.jsx`],
		version: 3,
	}),
)
writeFileSync(
	path.join(mappedPackageRoot, `dist`, `index.js`),
	`export function MappedEditor() { return null }`,
)
writeFileSync(
	path.join(mappedPackageRoot, `src`, `MappedEditor.jsx`),
	`
		export function MappedEditor() {
			return <mapped-editor><mapped-content><span /></mapped-content></mapped-editor>
		}
	`,
)

const declarationsOnlyPackageRoot = path.join(
	projectRoot,
	`node_modules`,
	`declarations-only-components`,
)

mkdirSync(declarationsOnlyPackageRoot, { recursive: true })
writeFileSync(
	path.join(declarationsOnlyPackageRoot, `package.json`),
	JSON.stringify({
		exports: {
			".": {
				default: `./index.js`,
				types: `./index.d.ts`,
			},
		},
		name: `declarations-only-components`,
		type: `module`,
	}),
)
writeFileSync(
	path.join(declarationsOnlyPackageRoot, `index.d.ts`),
	`export declare function OpaqueEditor(): unknown`,
)
writeFileSync(
	path.join(declarationsOnlyPackageRoot, `index.js`),
	`export function OpaqueEditor() { return null }`,
)

afterAll(() => {
	typescriptSession.close()
	rmSync(projectRoot, { force: true, recursive: true })
})

function validate(tsxSource: string, cssSource: string) {
	return validateCssReachability(
		{
			cssPath: path.join(sourceRoot, `AppPanel.module.css`),
			cssSource,
			tsxPath: path.join(sourceRoot, `AppPanel.tsx`),
			tsxSource,
		},
		typescriptSession,
	)
}

function diagnosticCodes(tsxSource: string, cssSource: string): string[] {
	return validate(tsxSource, cssSource).diagnostics.map(
		(diagnostic) => diagnostic.code,
	)
}

function consumerSource(
	importStatement: string,
	componentName: string,
): string {
	return `
		${importStatement}
		import css from "./AppPanel.module.css"

		export function AppPanel() {
			return (
				<app-panel className={css.class}>
					<${componentName} /* @lasertag-adopt-subtree */ />
				</app-panel>
			)
		}
	`
}

describe(`validated render-story adoption`, () => {
	it(`adopts the resolved subtree of one imported component instance`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { HeadlessEditor } from "./HeadlessEditor.tsx"`,
					`HeadlessEditor`,
				),
				`
					app-panel.class {
						> headless-editor > editable-region > caret-layer {}
					}
				`,
			),
		).toEqual([])
	})

	it(`reports ordinary dead selectors inside an adopted story`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { HeadlessEditor } from "./HeadlessEditor.tsx"`,
					`HeadlessEditor`,
				),
				`
					app-panel.class {
						> headless-editor > editable-region > selection-layer {}
					}
				`,
			),
		).toEqual([`dead-selector`])
	})

	it(`keeps the same imported component foreign without the annotation`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class}><HeadlessEditor /></app-panel>
					}
				`,
				`
					app-panel.class {
						> headless-editor > editable-region {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`keeps adoption local when another instance remains foreign`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<HeadlessEditor /* @lasertag-adopt-subtree */ />
								<HeadlessEditor />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> headless-editor > editable-region {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`preserves nested imported-component boundaries`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { ComposedEditor } from "./ComposedEditor.tsx"`,
					`ComposedEditor`,
				),
				`
					app-panel.class {
						> composed-editor > nested-toolbar > button {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`does not adopt consumer-supplied children`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { SlottedEditor } from "./SlottedEditor.tsx"`,
					`SlottedEditor`,
				),
				`
					app-panel.class {
						> slotted-editor > supplied-content {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`keeps render-prop output outside the adopted ownership boundary`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { RenderPropEditor } from "./RenderPropEditor.tsx"`,
					`RenderPropEditor`,
				),
				`
					app-panel.class {
						> render-prop-editor overlay-content {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`keeps portal output outside the adopted descendant story`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { PortalEditor } from "./PortalEditor.tsx"`,
					`PortalEditor`,
				),
				`
					app-panel.class {
						> portal-editor > local-content {}
						> portal-editor > portal-content {}
					}
				`,
			),
		).toEqual([`dead-selector`])
	})

	it(`keeps intrinsic-root assertions shallow inside an adopted story`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { AssertedEditor } from "./AssertedEditor.tsx"`,
					`AssertedEditor`,
				),
				`
					app-panel.class {
						> asserted-editor > svg {}
						> asserted-editor > svg > path {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`keeps unproven adopted branches as ownership boundaries`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { PartialEditor } from "./PartialEditor.tsx"`,
					`PartialEditor`,
				),
				`
					app-panel.class {
						> partial-editor > unknown-content {}
					}
				`,
			),
		).toEqual([`selector-crosses-ownership-boundary`])
	})

	it(`uses declaration source maps as package render-source evidence`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { MappedEditor } from "mapped-components"`,
					`MappedEditor`,
				),
				`
					app-panel.class {
						> mapped-editor > mapped-content > span {}
					}
				`,
			),
		).toEqual([])
	})

	it(`fails explicitly when no implementation source can be resolved`, () => {
		const result = validate(
			consumerSource(
				`import { OpaqueEditor } from "declarations-only-components"`,
				`OpaqueEditor`,
			),
			`app-panel.class {}`,
		)

		expect(result.diagnostics).toMatchObject([
			{
				code: `adoption-source-unavailable`,
				renderSourcePath: path.join(sourceRoot, `AppPanel.tsx`),
				renderSourceRange: {
					end: expect.any(Number),
					start: expect.any(Number),
				},
				selector: `@lasertag-adopt-subtree`,
			},
		])
	})

	it(`keeps intrinsic-root assertions shallow when adoption is requested`, () => {
		expect(
			diagnosticCodes(
				`
					import css from "./AppPanel.module.css"
					const svg = { Icon: () => <svg><path /></svg> }

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<svg.Icon /* @lasertag-adopt-subtree */ />
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> svg {}
					}
				`,
			),
		).toEqual([`adoption-source-unavailable`])
	})

	it.each([
		{
			label: `intrinsic element`,
			target: `<section /* @lasertag-adopt-subtree */ />`,
		},
		{
			label: `named fragment`,
			target: `<React.Fragment /* @lasertag-adopt-subtree */><section /></React.Fragment>`,
		},
		{
			label: `local component`,
			prefix: `function LocalPanel() { return <local-panel /> }`,
			target: `<LocalPanel /* @lasertag-adopt-subtree */ />`,
		},
		{
			label: `unbound member component`,
			target: `<Widgets.Panel /* @lasertag-adopt-subtree */ />`,
		},
	])(
		`reports an invalid adoption target for a $label`,
		({ prefix, target }) => {
			expect(
				diagnosticCodes(
					`
					${prefix ?? ``}
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								${target}
							</app-panel>
						)
					}
				`,
					`app-panel.class {}`,
				),
			).toEqual([`invalid-adoption-target`])
		},
	)

	it(`reports a recognized directive with extra comment content`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<HeadlessEditor /* @lasertag-adopt-subtree: the editor is headless */ />
							</app-panel>
						)
					}
				`,
				`app-panel.class {}`,
			),
		).toEqual([`invalid-adoption-directive`])
	})

	it(`does not mistake a similarly named comment for the directive`, () => {
		expect(
			diagnosticCodes(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<section /* @lasertag-adopt-subtree-ish */ />
							</app-panel>
						)
					}
				`,
				`app-panel.class {}`,
			),
		).toEqual([])
	})

	it(`reports the released sibling directive with migration guidance`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								{/* @lasertag-own-subtree */}
								<HeadlessEditor />
							</app-panel>
						)
					}
				`,
				`app-panel.class {}`,
			),
		).toEqual([`invalid-adoption-directive`])
	})

	it(`reports the new directive when it is misplaced as a sibling`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								{/* @lasertag-adopt-subtree */}
								<HeadlessEditor />
							</app-panel>
						)
					}
				`,
				`app-panel.class {}`,
			),
		).toEqual([`invalid-adoption-directive`])
	})

	it(`reports duplicate opening-tag directives`, () => {
		expect(
			diagnosticCodes(
				consumerSource(
					`import { HeadlessEditor } from "./HeadlessEditor.tsx"`,
					`HeadlessEditor /* @lasertag-adopt-subtree */`,
				),
				`app-panel.class {}`,
			),
		).toEqual([`invalid-adoption-directive`])
	})

	it(`recognizes the directive among attributes on a paired opening tag`, () => {
		expect(
			diagnosticCodes(
				`
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						const props = {}
						return (
							<app-panel className={css.class}>
								<HeadlessEditor
									before="yes"
									/* @lasertag-adopt-subtree */
									{...props}
									after="yes"
								></HeadlessEditor>
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> headless-editor > editable-region > caret-layer {}
					}
				`,
			),
		).toEqual([])
	})

	it(`does not read directive text from an attribute value`, () => {
		expect(
			diagnosticCodes(
				`
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return <app-panel className={css.class} title="/* @lasertag-adopt-subtree */" />
					}
				`,
				`app-panel.class {}`,
			),
		).toEqual([])
	})

	it(`adopts an imported component through transparent Solid control flow`, () => {
		expect(
			diagnosticCodes(
				`
					import { Show } from "solid-js"
					import { HeadlessEditor } from "./HeadlessEditor.tsx"
					import css from "./AppPanel.module.css"

					export function AppPanel() {
						return (
							<app-panel className={css.class}>
								<Show when={true}>
									<HeadlessEditor /* @lasertag-adopt-subtree */ />
								</Show>
							</app-panel>
						)
					}
				`,
				`
					app-panel.class {
						> headless-editor > editable-region > caret-layer {}
					}
				`,
			),
		).toEqual([])
	})

	it.each([
		{
			component: `For`,
			contents: `{() => <section />}`,
			props: `each={[]}`,
		},
		{
			component: `Switch`,
			contents: `<Match when={true}><section /></Match>`,
			imports: `Switch, Match`,
			props: ``,
		},
	])(
		`reports adoption directly around Solid $component control flow`,
		({ component, contents, imports = component, props }) => {
			expect(
				diagnosticCodes(
					`
						import { ${imports} } from "solid-js"
						import css from "./AppPanel.module.css"

						export function AppPanel() {
							return (
								<app-panel className={css.class}>
									<${component} /* @lasertag-adopt-subtree */ ${props}>
										${contents}
									</${component}>
								</app-panel>
							)
						}
					`,
					`app-panel.class {}`,
				),
			).toEqual([`invalid-adoption-target`])
		},
	)
})
