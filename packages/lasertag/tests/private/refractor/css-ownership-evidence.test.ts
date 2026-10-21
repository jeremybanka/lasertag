import { readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vite-plus/test"

import { analyzeRenderStory } from "../../../src/refractor/analyze-render-source.ts"
import { analyzeCssModuleSelectors } from "../../../src/refractor/analyze-css-module.ts"
import {
	analyzeCssOwnershipEvidence,
	type CssOwnershipOptions,
	type CssOwnershipResult,
} from "../../../src/refractor/css-ownership-evidence.ts"
import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import {
	createCssReachabilityDiagnostics,
	validateRenderSourceCssReachability,
} from "../../../src/refractor/validate-css-reachability.ts"
import { createDeadSelectorCleanupRanges } from "../../../src/lsp/code-actions.ts"
import { createCssMapperProject } from "./fixtures/css-project.ts"

const cssSource = `/* 🌱 café */\r\napp-panel.class { > button {} > missing-tag {} }`
const ambient = `declare module "*.module.css" { const css: { class: string }; export default css }`
const sourceText = `import css from "./AppPanel.module.css"; export function AppPanel() { return <app-panel className={css.class}><button /></app-panel> }`

function attachments(result: CssOwnershipResult) {
	if (result.ownership.status !== `available`)
		throw new Error(result.ownership.reason)
	return result.ownership.attachments
}
function options(
	project: ReturnType<typeof createCssMapperProject>,
	source = sourceText,
	name = `AppPanel.tsx`,
): CssOwnershipOptions {
	return {
		sourcePath: project.write(name, source),
		sourceText: source,
		runExternalCode: true,
	}
}

describe(`CSS mapper ownership evidence`, () => {
	it(`resolves css.class to an authored sibling selector with Unicode and CRLF offsets`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"env.d.ts": ambient,
		})
		const input = options(project)
		const result = analyzeCssOwnershipEvidence(input)
		expect(result.renderStory).toEqual(analyzeRenderStory(input))
		expect(attachments(result)).toEqual([
			{
				expression: `css.class`,
				attribute: `className`,
				usage: `direct`,
				legacyExpressionRecognized: true,
				range: {
					start: sourceText.indexOf(`css.class`),
					end: sourceText.indexOf(`css.class`) + 9,
				},
				status: `sibling`,
				targets: [
					{
						status: `sibling`,
						sourcePath: path.join(project.root, `AppPanel.module.css`),
						range: {
							start: cssSource.indexOf(`.class`) + 1,
							end: cssSource.indexOf(`.class`) + 6,
						},
					},
				],
			},
		])
	})

	it.each([
		[`import styles from "./AppPanel.module.css"`, `styles.class`],
		[`import styles from "./AppPanel.module.css"`, `styles["class"]`],
		[
			`import css from "./AppPanel.module.css"; const styles = css`,
			`styles.class`,
		],
		[`import * as styles from "./AppPanel.module.css"`, `styles.class`],
		[`import { styles } from "./barrel.ts"`, `styles.class`],
		[`import styles from "styles/Panel.module.css"`, `styles.class`],
		[`import css from "./AppPanel.module.css"`, `css?.class`],
	])(`resolves authored binding %s / %s`, (imports, expression) => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"styles/Panel.module.css": cssSource,
			"barrel.ts": `export { default as styles } from "./AppPanel.module.css"`,
		})
		const input = options(
			project,
			`${imports}; export function AppPanel() { return <app-panel class={${expression}} /> }`,
		)
		const evidence = attachments(analyzeCssOwnershipEvidence(input))
		expect(evidence).toHaveLength(1)
		expect(evidence[0]?.status).toBe(
			imports.includes(`styles/Panel`) ? `foreign` : `sibling`,
		)
		expect(evidence[0]?.targets[0]?.range).toEqual({
			start: cssSource.indexOf(`.class`) + 1,
			end: cssSource.indexOf(`.class`) + 6,
		})
	})

	it(`distinguishes foreign modules and shadowed bindings from sibling ownership`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"Other.module.css": `other-panel.class {}`,
		})
		const input = options(
			project,
			`import css from "./Other.module.css";
export function AppPanel() { return <app-panel class={css.class} /> }
export function LocalPanel(css: { class: string }) { return <local-panel class={css.class} /> }`,
		)
		const evidence = attachments(analyzeCssOwnershipEvidence(input))
		expect(
			evidence.map(({ status, legacyExpressionRecognized }) => [
				status,
				legacyExpressionRecognized,
			]),
		).toEqual([
			[`foreign`, true],
			[`non-css`, true],
		])
		expect(evidence[0]?.targets[0]?.sourcePath).toBe(
			path.join(project.root, `Other.module.css`),
		)
	})

	it(`treats conditional and mixed class expressions as references rather than guaranteed attachments`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"Other.module.css": `other-panel.class {}`,
		})
		const input = options(
			project,
			`import css from "./AppPanel.module.css"; import other from "./Other.module.css";
export function AppPanel() { return <app-panel class={flag ? css.class : other.class} /> }`,
		)
		expect(
			attachments(analyzeCssOwnershipEvidence(input)).map(
				({ status, usage }) => [status, usage],
			),
		).toEqual([
			[`sibling`, `expression`],
			[`foreign`, `expression`],
		])
	})

	it.each([`class`, `class:list`])(
		`resolves Astro %s expressions through both real mappers`,
		(attribute) => {
			using project = createCssMapperProject({
				"AppPanel.module.css": cssSource,
				"env.d.ts": ambient,
			})
			const input = options(
				project,
				`---\r\nimport css from "./AppPanel.module.css"\r\n---\r\n<!-- 🌱 café -->\r\n<app-panel ${attribute}={${attribute === `class` ? `css.class` : `[css.class, flag]`}}><slot /></app-panel>`,
				`AppPanel.astro`,
			)
			const result = analyzeCssOwnershipEvidence(input)
			expect(result.renderStory).toEqual(analyzeRenderStory(input))
			expect(attachments(result)).toMatchObject([
				{
					status: `sibling`,
					expression: `css.class`,
					attribute,
					range: { start: input.sourceText.indexOf(`css.class`) },
					targets: [
						{ sourcePath: path.join(project.root, `AppPanel.module.css`) },
					],
				},
			])
		},
	)

	it.each([
		`#class {}`,
		`:global(.class) {}`,
		`:global .class {}`,
		`app-panel { content: ".class" }`,
		`/* .class {} */ app-panel {}`,
		`.cl\\61ss {}`,
	])(`does not promote a synthetic or unverified export from %s`, (css) => {
		using project = createCssMapperProject({ "AppPanel.module.css": css })
		const evidence = attachments(analyzeCssOwnershipEvidence(options(project)))
		expect(evidence).toHaveLength(1)
		expect([`unverified`, `unresolved`]).toContain(evidence[0]?.status)
	})

	it.each([`missing`, `disabled`, `ambient`])(
		`does not mistake %s mapping evidence for a stylesheet`,
		(mode) => {
			using project = createCssMapperProject(
				{
					"AppPanel.module.css": cssSource,
					...(mode === `ambient` ? { "env.d.ts": ambient } : {}),
				},
				mode !== `missing` && mode !== `ambient`,
			)
			const input = {
				...options(project),
				runExternalCode: mode !== `disabled`,
			}
			const result = analyzeCssOwnershipEvidence(input)
			expect(result.renderStory).toEqual(analyzeRenderStory(input))
			expect(attachments(result)[0]?.status).toBe(
				mode === `ambient` ? `ambient` : `unresolved`,
			)
		},
	)

	it(`reuses a session across unsaved CSS, import edits, closes and disk changes`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"Other.module.css": `other-panel.class {}`,
		})
		const input = options(project)
		const cssPath = path.join(project.root, `AppPanel.module.css`)
		using session = createTypescriptAstSession({ runExternalCode: true })
		const run = (extra: Partial<CssOwnershipOptions> = {}) =>
			attachments(
				analyzeCssOwnershipEvidence({ ...input, ...extra }, session),
			)[0]
		expect(run()?.status).toBe(`sibling`)
		expect(
			run({
				typescriptSource: {
					openFiles: new Map([[cssPath, `\n\n${cssSource}`]]),
				},
			})?.targets[0]?.range?.start,
		).toBe(cssSource.indexOf(`.class`) + 3)
		expect(
			run({
				typescriptSource: { openFiles: new Map([[cssPath, `app-panel {}`]]) },
			})?.status,
		).toBe(`unresolved`)
		expect(run({ typescriptSource: { openFiles: new Map() } })?.status).toBe(
			`sibling`,
		)
		expect(
			run({
				sourceText: sourceText.replace(
					`./AppPanel.module.css`,
					`./Other.module.css`,
				),
			})?.status,
		).toBe(`foreign`)
		expect(run()?.status).toBe(`sibling`)
		project.write(`AppPanel.module.css`, `app-panel {}`)
		expect(run()?.status).toBe(`unresolved`)
		project.write(`AppPanel.module.css`, cssSource)
		expect(run({ typescriptSource: { invalidate: true } })?.status).toBe(
			`sibling`,
		)
		rmSync(cssPath)
		expect(run({ typescriptSource: { invalidate: true } })?.status).toBe(
			`unresolved`,
		)
		project.write(`AppPanel.module.css`, cssSource)
		expect(run({ typescriptSource: { invalidate: true } })?.status).toBe(
			`sibling`,
		)
	})

	it(`keeps the .class-only contract, selectors, stories, diagnostics and cleanup identical`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": `${cssSource}\napp-panel.illegal {}`,
		})
		const input = options(project)
		const css = readFileSync(
			path.join(project.root, `AppPanel.module.css`),
			`utf8`,
		)
		const baseline = validateRenderSourceCssReachability({
			...input,
			cssSource: css,
		})
		const result = analyzeCssOwnershipEvidence(input)
		const diagnostics = createCssReachabilityDiagnostics({
			renderStory: result.renderStory,
			cssSource: css,
			selectorAnalyses: analyzeCssModuleSelectors(css),
		})
		expect(result.renderStory).toEqual(baseline.renderStory)
		expect(diagnostics).toEqual(baseline.diagnostics)
		expect(
			diagnostics.some(({ code }) => code === `impossible-local-class`),
		).toBe(true)
		const ranges = (items: typeof diagnostics) =>
			items.flatMap(({ range }) => (range ? [range] : []))
		expect(createDeadSelectorCleanupRanges(css, ranges(diagnostics))).toEqual(
			createDeadSelectorCleanupRanges(css, ranges(baseline.diagnostics)),
		)
		expect(
			attachments(
				analyzeCssOwnershipEvidence({
					...input,
					sourceText: sourceText.replace(`css.class`, `css.illegal`),
				}),
			),
		).toEqual([])
	})

	it(`rejects ambiguous ownership from a conditional module binding`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"Other.module.css": `other-panel.class {}`,
		})
		const input = options(
			project,
			`import own from "./AppPanel.module.css"; import other from "./Other.module.css"; const css = flag ? own : other; export function AppPanel() { return <app-panel class={css.class} /> }`,
		)
		expect(attachments(analyzeCssOwnershipEvidence(input))).toMatchObject([
			{ status: `ambiguous`, targets: [] },
		])
	})

	it(`keeps imported Astro component projections out of the public story`, () => {
		using project = createCssMapperProject({
			"AppPanel.module.css": cssSource,
			"ChildPanel.astro": `<unexpected-body><slot /></unexpected-body>`,
		})
		const input = options(
			project,
			`import css from "./AppPanel.module.css"; import ChildPanel from "./ChildPanel.astro"; export function AppPanel() { return <app-panel class={css.class}><ChildPanel /></app-panel> }`,
		)
		const result = analyzeCssOwnershipEvidence(input)
		expect(result.renderStory).toEqual(analyzeRenderStory(input))
		expect(attachments(result)[0]?.status).toBe(`sibling`)
	})

	it.each([
		`let css = styles`,
		`const css = ({ class: "invented" } as typeof styles)`,
		`declare const css: typeof styles`,
	])(`does not infer runtime ownership from %s`, (binding) => {
		using project = createCssMapperProject({ "AppPanel.module.css": cssSource })
		const input = options(
			project,
			`import styles from "./AppPanel.module.css"; ${binding}; export function AppPanel() { return <app-panel class={css.class} /> }`,
		)
		expect(attachments(analyzeCssOwnershipEvidence(input))).toMatchObject([
			{ status: `unverified` },
		])
	})

	it.each([
		`crash`,
		`unmapped`,
		`no-definition`,
		`wrong-range`,
		`comment`,
		`attribute`,
		`prefix`,
	])(`does not promote %s mapper output to CSS ownership`, (mode) => {
		const css =
			mode === `comment`
				? `app-panel/* .class */ {}`
				: mode === `attribute`
					? `app-panel[data-name=".class"] {}`
					: mode === `prefix`
						? `app-panel.class-extra {}`
						: cssSource
		using project = createCssMapperProject({ "AppPanel.module.css": css })
		const mapper = path.join(project.root, `bad-css-mapper`)
		project.write(
			`bad-css-mapper/package.json`,
			JSON.stringify({
				name: `bad-css-mapper`,
				version: `1.0.0`,
				typescript: {
					contentMapper: {
						exec: [
							process.execPath,
							fileURLToPath(
								new URL(`./fixtures/css-content-mapper.ts`, import.meta.url),
							),
						],
						compilerOptions: [],
					},
				},
			}),
		)
		project.write(
			`tsconfig.json`,
			JSON.stringify({
				compilerOptions: {
					jsx: `preserve`,
					moduleResolution: `bundler`,
					module: `esnext`,
					allowSyntheticDefaultImports: true,
				},
				contentMappers: [
					{ package: mapper, extensions: [`.module.css`], options: { mode } },
				],
			}),
		)
		const input = options(project)
		const result = analyzeCssOwnershipEvidence(input)
		expect(result.renderStory).toEqual(analyzeRenderStory(input))
		if (mode === `crash` && result.ownership.status === `unavailable`) return
		expect(attachments(result)[0]?.status).toBe(
			mode === `crash`
				? `unresolved`
				: [`wrong-range`, `comment`, `attribute`, `prefix`].includes(mode)
					? `unverified`
					: `unmapped`,
		)
	})
})
