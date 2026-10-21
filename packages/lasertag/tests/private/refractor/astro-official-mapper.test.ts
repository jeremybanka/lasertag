import { rmSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import { analyzeAstroRenderStory } from "../../../src/refractor/analyze-astro.ts"
import { analyzeCssModuleSelectors } from "../../../src/refractor/analyze-css-module.ts"
import { analyzeAstroSemanticEvidence } from "../../../src/refractor/astro-semantic-evidence.ts"
import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import { createCssReachabilityDiagnostics } from "../../../src/refractor/validate-css-reachability.ts"
import { createOfficialAstroProject } from "../../public/lsp/fixtures/astro-project.ts"

const card = `export function ActualCard() { return <actual-card /> }`
const other = `export function OtherCard() { return <other-card /> }`
const child = `---\n// 🌱 café\nexport function AstroChild() {}\n---\n<child-body><slot /></child-body>`
const files = {
	"components/Card.tsx": card,
	"components/Other.tsx": other,
	"components/Child.astro": child,
	"barrel.ts": `export { ActualCard as RenamedCard } from "./components/Card.tsx"`,
}

describe(`official Astro content mapper`, () => {
	it.each([
		`<Frame />`,
		`<Frame></Frame>`,
		`<!-- 🌱 café -->\n<Frame />`,
		`<><Frame /></>`,
		`{visible && <Frame />}`,
	])(`finds the authored reference in %s`, (template) => {
		using project = createOfficialAstroProject(files)
		const options = project.options(
			`---\nimport Frame from "ui/Child.astro"\n---\n${template}`,
		)
		const result = analyzeAstroSemanticEvidence(options)
		expect(result.semantics).toMatchObject({
			status: `available`,
			components: [
				{
					name: `Frame`,
					status: `resolved`,
					range: {
						start: options.sourceText.indexOf(`<Frame`) + 1,
						end: options.sourceText.indexOf(`<Frame`) + 6,
					},
					declarations: [
						{ sourcePath: path.join(project.root, `components/Child.astro`) },
					],
				},
			],
		})
		expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
	})

	it.each([`\n`, `\r\n`])(
		`resolves path, barrel, namespace and default aliases with %j line endings`,
		(newline) => {
			using project = createOfficialAstroProject(files)
			const options = project.options(
				`---
import { RenamedCard as Short } from "./barrel.ts"
import * as Cards from "ui/Card.tsx"
import Frame from "ui/Child.astro"
import NamedLayout from "ui/Child.astro"
import { AstroChild } from "ui/Child.astro"
---
<!-- 🌱 café -->
<app-panel><Short></Short><Cards.ActualCard /><Frame /><NamedLayout /><AstroChild /></app-panel>`.replaceAll(
					`\n`,
					newline,
				),
			)
			const result = analyzeAstroSemanticEvidence(options)
			expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
			expect(result.semantics.status).toBe(`available`)
			if (result.semantics.status !== `available`) return
			const references = result.semantics.components
			expect(references.map(({ name, status }) => [name, status])).toEqual([
				[`Short`, `resolved`],
				[`Cards.ActualCard`, `resolved`],
				[`Frame`, `resolved`],
				[`NamedLayout`, `resolved`],
				[`AstroChild`, `resolved`],
			])
			for (const reference of references) {
				expect(
					options.sourceText.slice(reference.range.start, reference.range.end),
				).toBe(reference.name)
			}
			expect(references[0]?.declarations).toEqual([
				{
					kind: `source`,
					sourcePath: path.join(project.root, `components/Card.tsx`),
					range: { start: 0, end: card.length },
				},
			])
			expect(references[1]?.declarations).toEqual(references[0]?.declarations)
			// Different authored names identify the same file; neither proves a DOM root.
			expect(references[2]?.declarations).toEqual([
				{
					sourcePath: path.join(project.root, `components/Child.astro`),
					kind: `source`,
				},
			])
			expect(references[3]?.declarations).toEqual(references[2]?.declarations)
			expect(references[4]?.declarations).toEqual([
				{
					kind: `source`,
					sourcePath: path.join(project.root, `components/Child.astro`),
					range: {
						start: child.indexOf(`export function`),
						end: child.indexOf(`\n---`, 4),
					},
				},
			])
		},
	)

	it(`distinguishes missing imports, ambient declarations and dynamic local bindings`, () => {
		using project = createOfficialAstroProject({
			...files,
			"env.d.ts": `declare module "*.mdx" { export const Content: any }`,
		})
		const options = project.options(`---
import { ActualCard } from "ui/Card.tsx"
import { OtherCard } from "ui/Other.tsx"
import { MissingCard } from "./missing.tsx"
import { Content } from "./article.mdx"
const Dynamic = Math.random() ? ActualCard : OtherCard
---
<app-panel><MissingCard /><Content /><Dynamic /><custom-element /></app-panel>`)
		const result = analyzeAstroSemanticEvidence(options)
		expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
		expect(result.semantics).toMatchObject({
			status: `available`,
			components: [
				{ name: `MissingCard`, status: `unresolved`, declarations: [] },
				{
					name: `Content`,
					status: `resolved`,
					declarations: [{ sourcePath: path.join(project.root, `env.d.ts`) }],
				},
				{
					name: `Dynamic`,
					status: `resolved`,
					declarations: [{ sourcePath: options.filePath }],
				},
			],
		})
		if (result.semantics.status !== `available`) return
		const range = result.semantics.components[2]?.declarations[0]?.range
		expect(range).toBeDefined()
		expect(options.sourceText.slice(range!.start, range!.end)).toBe(
			`Dynamic = Math.random() ? ActualCard : OtherCard`,
		)
	})

	it(`keeps scripts, slots, hydrated islands and injected HTML out of semantic DOM inference`, () => {
		using project = createOfficialAstroProject(files)
		const options = project.options(`---
import Frame from "ui/Child.astro"
import { ActualCard as Island } from "ui/Card.tsx"
import css from "./AppPanel.module.css"
const html = "<injected-child />"
---
<app-panel class={css.class}>
  <Frame><slot><fallback-child /></slot></Frame>
  <Island client:only="preact" />
  <section set:html={html} />
  {unknownContent}
</app-panel>
<script>const scriptText = "<ScriptOnly />"; console.log(scriptText)</script>`)
		const cssSource = `app-panel.class { > frame > child-body {} > island > actual-card {} > section > injected-child {} > missing-child {} }`
		const baseline = analyzeAstroRenderStory(options)
		const diagnostics = (renderStory: typeof baseline) =>
			createCssReachabilityDiagnostics({
				renderStory,
				cssSource,
				selectorAnalyses: analyzeCssModuleSelectors(cssSource),
			})
		for (const runExternalCode of [true, false]) {
			const result = analyzeAstroSemanticEvidence({
				...options,
				runExternalCode,
			})
			expect(result.renderStory).toEqual(baseline)
			expect(diagnostics(result.renderStory)).toEqual(diagnostics(baseline))
			if (runExternalCode) {
				expect(result.semantics).toMatchObject({
					status: `available`,
					components: [
						{ name: `Frame`, status: `resolved` },
						{ name: `Island`, status: `resolved` },
					],
				})
			} else expect(result.semantics.status).toBe(`unavailable`)
		}
	})

	it(`refreshes unsaved aliases, barrel targets and deleted declarations`, () => {
		using project = createOfficialAstroProject(files)
		using session = createTypescriptAstSession({ runExternalCode: true })
		const options = project.options(
			`---\nimport { RenamedCard as Short } from "./barrel.ts"\n---\n<app-panel><Short /></app-panel>`,
		)
		const target = () =>
			analyzeAstroSemanticEvidence(options, session).semantics
		expect(target()).toMatchObject({
			components: [
				{
					name: `Short`,
					declarations: [
						{ sourcePath: path.join(project.root, `components/Card.tsx`) },
					],
				},
			],
		})
		options.sourceText = options.sourceText.replaceAll(`Short`, `OtherName`)
		expect(target()).toMatchObject({
			components: [{ name: `OtherName`, status: `resolved` }],
		})
		project.write(
			`barrel.ts`,
			`export { OtherCard as RenamedCard } from "./components/Other.tsx"`,
		)
		expect(target()).toMatchObject({
			components: [
				{
					declarations: [
						{ sourcePath: path.join(project.root, `components/Other.tsx`) },
					],
				},
			],
		})
		rmSync(path.join(project.root, `components/Other.tsx`))
		expect(target()).toMatchObject({
			components: [{ status: `unresolved`, declarations: [] }],
		})
		project.write(`components/Other.tsx`, other)
		expect(target()).toMatchObject({
			components: [
				{
					status: `resolved`,
					declarations: [
						{ sourcePath: path.join(project.root, `components/Other.tsx`) },
					],
				},
			],
		})
	})

	it(`refreshes authored declaration ranges when an imported Astro file changes`, () => {
		using project = createOfficialAstroProject(files)
		using session = createTypescriptAstSession({ runExternalCode: true })
		const options = project.options(
			`---\nimport { AstroChild } from "ui/Child.astro"\n---\n<app-panel><AstroChild /></app-panel>`,
		)
		const first = analyzeAstroSemanticEvidence(options, session)
		const editedChild = child.replace(
			`// 🌱 café`,
			`// a longer comment 🌱 café`,
		)
		project.write(`components/Child.astro`, editedChild)
		const second = analyzeAstroSemanticEvidence(options, session)
		expect(first.semantics).not.toEqual(second.semantics)
		expect(second.semantics).toMatchObject({
			components: [
				{
					declarations: [
						{
							range: {
								start: editedChild.indexOf(`export function`),
								end: editedChild.indexOf(`\n---`, 4),
							},
						},
					],
				},
			],
		})
		expect(second.renderStory).toEqual(first.renderStory)
	})

	it(`discovers a dependency created after an initially missing import`, () => {
		using project = createOfficialAstroProject()
		using session = createTypescriptAstSession({ runExternalCode: true })
		const options = project.options(
			`---\nimport { ActualCard } from "./New.tsx"\n---\n<app-panel><ActualCard /></app-panel>`,
		)
		expect(
			analyzeAstroSemanticEvidence(options, session).semantics,
		).toMatchObject({
			components: [{ status: `unresolved`, declarations: [] }],
		})
		project.write(`New.tsx`, card)
		expect(
			analyzeAstroSemanticEvidence(options, session).semantics,
		).toMatchObject({
			components: [
				{
					status: `resolved`,
					declarations: [{ sourcePath: path.join(project.root, `New.tsx`) }],
				},
			],
		})
	})

	it(`retains the template story when authored frontmatter has a syntax error`, () => {
		using project = createOfficialAstroProject(files)
		const options = project.options(
			`---\nimport Frame from "ui/Child.astro"\nconst broken = ;\n---\n<app-panel><Frame /></app-panel>`,
		)
		const result = analyzeAstroSemanticEvidence(options)
		expect(result.semantics.status).toBe(`unavailable`)
		expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
	})
})
