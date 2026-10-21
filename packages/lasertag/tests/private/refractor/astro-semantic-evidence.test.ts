import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vite-plus/test"

import { analyzeCssModuleSelectors } from "../../../src/refractor/analyze-css-module.ts"
import { analyzeAstroRenderStory } from "../../../src/refractor/analyze-astro.ts"
import { analyzeAstroSemanticEvidence } from "../../../src/refractor/astro-semantic-evidence.ts"
import { createTypescriptAstSession } from "../../../src/refractor/typescript-ast.ts"
import {
	createCssReachabilityDiagnostics,
	validateRenderSourceCssReachability,
} from "../../../src/refractor/validate-css-reachability.ts"

const fixtureRoots: string[] = []
afterEach(() => {
	for (const root of fixtureRoots.splice(0))
		rmSync(root, { recursive: true, force: true })
})

function fixture(mode?: string, configured = true) {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-astro-mapper-`))
	fixtureRoots.push(root)
	const mapper = path.join(root, `node_modules`, `test-astro-mapper`)
	mkdirSync(mapper, { recursive: true })
	writeFileSync(
		path.join(mapper, `package.json`),
		JSON.stringify({
			name: `test-astro-mapper`,
			version: `1.0.0`,
			typescript: {
				contentMapper: {
					exec: [
						process.execPath,
						fileURLToPath(
							new URL(`./fixtures/astro-content-mapper.ts`, import.meta.url),
						),
					],
					compilerOptions: [],
				},
			},
		}),
	)
	writeFileSync(
		path.join(root, `tsconfig.json`),
		JSON.stringify({
			compilerOptions: {
				jsx: `preserve`,
				module: `esnext`,
				moduleResolution: `bundler`,
				allowImportingTsExtensions: true,
				noEmit: true,
			},
			...(configured
				? {
						contentMappers: [
							{
								package: `test-astro-mapper`,
								extensions: [`.astro`],
								options: { mode },
							},
						],
					}
				: {}),
		}),
	)
	writeFileSync(
		path.join(root, `Card.tsx`),
		`export function ActualCard() { return <actual-card /> }\nexport function OtherCard() { return <other-card /> }`,
	)
	writeFileSync(
		path.join(root, `barrel.ts`),
		`export { ActualCard as RenamedCard } from "./Card.tsx"`,
	)
	const filePath = path.join(root, `AppPanel.astro`)
	const sourceText = `---\nimport { RenamedCard as Card } from "./barrel.ts"\nimport * as Cards from "./Card.tsx"\nimport { ActualCard, OtherCard } from "./Card.tsx"\n---\n<!-- 🌱 café -->\n<app-panel class={css.class}><Card /><Cards.ActualCard /><slot />{content}</app-panel>`
	writeFileSync(filePath, sourceText)
	return { filePath, sourceText, runExternalCode: true, root }
}

describe(`Astro content mapper semantic prototype`, () => {
	it(`resolves aliases and namespace members without using generated DOM or supplemental scripts`, () => {
		const options = fixture()
		const result = analyzeAstroSemanticEvidence(options)
		expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
		expect(result.semantics).toMatchObject({
			status: `available`,
			components: [
				{
					name: `Card`,
					status: `resolved`,
					range: { start: options.sourceText.indexOf(`<Card />`) + 1 },
					declarations: [{ sourcePath: path.join(options.root, `Card.tsx`) }],
				},
				{
					name: `Cards.ActualCard`,
					status: `resolved`,
					declarations: [{ sourcePath: path.join(options.root, `Card.tsx`) }],
				},
			],
		})
		expect(JSON.stringify(result.renderStory)).not.toMatch(
			/invented-|script-only|actual-card/,
		)
	})

	it.each([`duplicate`, `atom`])(
		`accepts %s projections as symbol evidence only`,
		(mode) => {
			const options = fixture(mode)
			const result = analyzeAstroSemanticEvidence(options)
			expect(result.semantics).toMatchObject({
				status: `available`,
				components: [
					{
						status: `resolved`,
						declarations: [{ sourcePath: path.join(options.root, `Card.tsx`) }],
					},
					{},
				],
			})
			expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
		},
	)

	it.each([`ambiguous`, `unmapped`])(
		`does not invent evidence for %s projections`,
		(mode) => {
			const options = fixture(mode)
			const result = analyzeAstroSemanticEvidence(options)
			expect(result.semantics).toMatchObject({
				status: `available`,
				components: [{ status: mode, declarations: [] }, {}],
			})
			expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
		},
	)

	it.each([`crash`, `empty`, `diagnostic`, `missing`, `disabled`])(
		`keeps the template story and CSS decisions when the mapper is %s`,
		(mode) => {
			const options = {
				...fixture(mode, mode !== `missing`),
				runExternalCode: mode !== `disabled`,
			}
			const result = analyzeAstroSemanticEvidence(options)
			expect(result.semantics.status).toBe(`unavailable`)
			expect(result.renderStory).toEqual(analyzeAstroRenderStory(options))
			const cssSource = `app-panel.class { > header {} > card {} > arbitrary-content {} }`
			expect(
				createCssReachabilityDiagnostics({
					renderStory: result.renderStory,
					cssSource,
					selectorAnalyses: analyzeCssModuleSelectors(cssSource),
				}),
			).toEqual(
				validateRenderSourceCssReachability({
					sourcePath: options.filePath,
					sourceText: options.sourceText,
					cssSource,
				}).diagnostics,
			)
		},
	)

	it(`refreshes unsaved source and imported declarations in a reused session`, () => {
		const options = fixture()
		using session = createTypescriptAstSession({ runExternalCode: true })
		const first = analyzeAstroSemanticEvidence(options, session)
		const sourceText = options.sourceText.replace(`<Card />`, `<OtherCard />`)
		const second = analyzeAstroSemanticEvidence(
			{ ...options, sourceText },
			session,
		)
		expect(first.semantics).toMatchObject({
			components: [{ name: `Card`, status: `resolved` }, {}],
		})
		expect(second.semantics).toMatchObject({
			components: [{ name: `OtherCard`, status: `resolved` }, {}],
		})
		writeFileSync(
			path.join(options.root, `Card.tsx`),
			`export function ActualCard() { return <actual-card /> }`,
		)
		const third = analyzeAstroSemanticEvidence(
			{ ...options, sourceText },
			session,
		)
		expect(third.semantics).toMatchObject({
			components: [
				{ name: `OtherCard`, status: `unresolved`, declarations: [] },
				{},
			],
		})
	})

	it(`maps declaration locations back into an imported Astro file`, () => {
		const options = fixture()
		const childPath = path.join(options.root, `Child.astro`)
		const childSource = `---\n// 🌱\nexport function AstroChild() {}\n---\n<child-body />`
		writeFileSync(childPath, childSource)
		const sourceText = `---\nimport { AstroChild } from "./Child.astro"\n---\n<app-panel><AstroChild /></app-panel>`
		const result = analyzeAstroSemanticEvidence({ ...options, sourceText })
		expect(result.semantics).toMatchObject({
			status: `available`,
			components: [
				{
					name: `AstroChild`,
					status: `resolved`,
					declarations: [
						{
							sourcePath: childPath,
							range: {
								start: childSource.indexOf(`export function`),
								end: childSource.indexOf(`\n---`, 4),
							},
						},
					],
				},
			],
		})
		expect(result.renderStory).toEqual(
			analyzeAstroRenderStory({ ...options, sourceText }),
		)
	})
})
