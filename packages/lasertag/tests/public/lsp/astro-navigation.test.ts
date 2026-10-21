import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vite-plus/test"
import type { Location, LocationLink } from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import { createOfficialAstroProject } from "./fixtures/astro-project.ts"
import { createLspClient } from "./helpers/client.ts"

const enabled = {}
const card = `// 🌱 café\nexport function ActualCard() { return <actual-card /> }`
const child = `---\nconst title = "hello"\n---\n<child-body><slot /></child-body>`
const files = {
	"Card.tsx": card,
	"Child.astro": child,
	"barrel.ts": `export { ActualCard as Card } from "./Card.tsx"`,
	"ambient.d.ts": `declare module "*.mdx" { export const Content: any }`,
	"Declared.ts": `export declare function Declared(): unknown`,
}
const source = `---
import { Card as Renamed } from "./barrel.ts"
import * as Cards from "./Card.tsx"
import Frame from "./Child.astro"
import { Content } from "./article.mdx"
import { Declared } from "./Declared.ts"
---
<!-- 🌱 café -->
<app-panel class={css.class}><Renamed></Renamed><Cards.ActualCard /><Frame /><Content /><Declared /></app-panel>`

function params(filePath: string, text: string, needle: string) {
	const uri = pathToFileURL(filePath).href
	const document = TextDocument.create(uri, `astro`, 1, text)
	return {
		textDocument: { uri },
		position: document.positionAt(
			text.indexOf(needle) + (needle.startsWith(`</`) ? 2 : 1),
		),
	}
}

describe(`automatic Astro LSP navigation`, () => {
	it(`does not execute navigation mappers in an untrusted workspace`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		await using client = createLspClient(project.root)
		const result = await client.initialize({ workspaceTrusted: false })
		expect(result.capabilities).not.toHaveProperty(`definitionProvider`)
		expect(result.capabilities).not.toHaveProperty(`declarationProvider`)
		client.open(filePath, source)
		expect(
			await client.request(
				`textDocument/definition`,
				params(filePath, source, `<Renamed`),
			),
		).toEqual([])
		expect(
			await client.request(
				`textDocument/declaration`,
				params(filePath, source, `<Content`),
			),
		).toEqual([])
	})

	it(`separates source definitions from ambient declarations, including declare in a .ts file`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		await using client = createLspClient(project.root)
		expect((await client.initialize(enabled)).capabilities).toMatchObject({
			definitionProvider: true,
			declarationProvider: true,
		})
		client.open(filePath, source)
		for (const needle of [`<Renamed`, `</Renamed`, `<Cards.ActualCard`]) {
			const links = await client.request<LocationLink[]>(
				`textDocument/definition`,
				params(filePath, source, needle),
			)
			expect(links).toHaveLength(1)
			expect(links[0]).toMatchObject({
				targetUri: pathToFileURL(path.join(project.root, `Card.tsx`)).href,
				targetRange: { start: { line: 1, character: 0 } },
			})
			expect(
				await client.request(
					`textDocument/declaration`,
					params(filePath, source, needle),
				),
			).toEqual([])
		}
		const frame = await client.request<LocationLink[]>(
			`textDocument/definition`,
			params(filePath, source, `<Frame`),
		)
		expect(frame).toMatchObject([
			{
				targetUri: pathToFileURL(path.join(project.root, `Child.astro`)).href,
				targetSelectionRange: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 0 },
				},
			},
		])
		for (const [name, target] of [
			[`Content`, `ambient.d.ts`],
			[`Declared`, `Declared.ts`],
		]) {
			expect(
				await client.request(
					`textDocument/definition`,
					params(filePath, source, `<${name}`),
				),
			).toEqual([])
			expect(
				await client.request(
					`textDocument/declaration`,
					params(filePath, source, `<${name}`),
				),
			).toMatchObject([
				{ targetUri: pathToFileURL(path.join(project.root, target!)).href },
			])
		}
		expect(
			await client.request(
				`textDocument/definition`,
				params(filePath, source, `<app-panel`),
			),
		).toEqual([])
	})

	it(`returns Locations for clients without link support`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		await using client = createLspClient(project.root)
		await client.initialize(enabled, false)
		client.open(filePath, source)
		const locations = await client.request<Location[]>(
			`textDocument/definition`,
			params(filePath, source, `<Renamed`),
		)
		expect(locations).toMatchObject([
			{
				uri: pathToFileURL(path.join(project.root, `Card.tsx`)).href,
				range: { start: { line: 1, character: 0 } },
			},
		])
		expect(locations[0]).not.toHaveProperty(`targetUri`)
	})

	it(`uses unsaved imports and closing a dependency restores its disk declaration`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		const cardPath = path.join(project.root, `Card.tsx`)
		await using client = createLspClient(project.root)
		await client.initialize(enabled)
		client.open(filePath, source)
		const navigate = () =>
			client.request<LocationLink[]>(
				`textDocument/definition`,
				params(filePath, source, `<Renamed`),
			)
		expect((await navigate())[0]?.targetRange.start.line).toBe(1)
		client.open(cardPath, `\n\n${card}`, `typescriptreact`)
		expect((await navigate())[0]?.targetRange.start.line).toBe(3)
		client.change(
			cardPath,
			`export function DifferentCard() { return <different-card /> }`,
		)
		expect(await navigate()).toEqual([])
		client.close(cardPath)
		expect((await navigate())[0]?.targetRange.start.line).toBe(1)
		const edited = source.replaceAll(`Renamed`, `OtherAlias`)
		client.change(filePath, edited)
		expect(
			await client.request(
				`textDocument/definition`,
				params(filePath, edited, `<OtherAlias`),
			),
		).toMatchObject([{ targetUri: pathToFileURL(cardPath).href }])
		client.close(filePath)
		client.open(filePath, source, `astro`, 3)
		expect((await navigate())[0]?.targetRange.start.line).toBe(1)
	})

	it(`refreshes disk imports and configuration after watched-file notifications`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		await using client = createLspClient(project.root)
		await client.initialize(enabled)
		client.open(filePath, source)
		const navigate = () =>
			client.request<LocationLink[]>(
				`textDocument/definition`,
				params(filePath, source, `<Renamed`),
			)
		expect((await navigate())[0]?.targetUri).toBe(
			pathToFileURL(path.join(project.root, `Card.tsx`)).href,
		)
		const nextPath = project.write(
			`NextCard.tsx`,
			`export function NextCard() { return <next-card /> }`,
		)
		const barrelPath = project.write(
			`barrel.ts`,
			`export { NextCard as Card } from "./NextCard.tsx"`,
		)
		client.notify(`workspace/didChangeWatchedFiles`, {
			changes: [
				{ uri: pathToFileURL(nextPath).href, type: 1 },
				{ uri: pathToFileURL(barrelPath).href, type: 2 },
			],
		})
		expect((await navigate())[0]?.targetUri).toBe(pathToFileURL(nextPath).href)
		const configPath = project.write(
			`tsconfig.json`,
			`{ "compilerOptions": { "jsx": "preserve" } }`,
		)
		client.notify(`workspace/didChangeWatchedFiles`, {
			changes: [{ uri: pathToFileURL(configPath).href, type: 2 }],
		})
		expect(await navigate()).toEqual([])
	})

	it(`restricts navigation to the configured workspace`, async () => {
		using project = createOfficialAstroProject()
		using outside = createOfficialAstroProject(files)
		const { filePath } = outside.options(source)
		await using client = createLspClient(project.root)
		await client.initialize(enabled)
		client.open(filePath, source)
		expect(
			await client.request(
				`textDocument/definition`,
				params(filePath, source, `<Renamed`),
			),
		).toEqual([])
	})

	it(
		`keeps stories, completions and cleanup edits identical with navigation enabled or unavailable`,
		{ timeout: 20_000 },
		async () => {
			using project = createOfficialAstroProject(files)
			const { filePath } = project.options(source)
			const cssPath = project.write(
				`AppPanel.module.css`,
				`app-panel.class { > renamed {} > missing-tag {} }`,
			)
			const cssUri = pathToFileURL(cssPath).href
			const responses: unknown[] = []
			for (const mode of [`disabled`, `enabled`, `unavailable`]) {
				if (mode === `unavailable`)
					project.write(
						`tsconfig.json`,
						`{ "compilerOptions": { "jsx": "preserve" } }`,
					)
				await using client = createLspClient(project.root)
				await client.initialize(
					mode === `disabled` ? { workspaceTrusted: false } : enabled,
				)
				client.open(filePath, source)
				client.open(
					cssPath,
					`app-panel.class { > renamed {} > missing-tag {} }`,
					`css`,
				)
				const baseline = await client.request(`lasertag/renderStory`, {
					uri: cssUri,
				})
				await client.request(
					`textDocument/definition`,
					params(filePath, source, `<Renamed`),
				)
				expect(
					await client.request(`lasertag/renderStory`, { uri: cssUri }),
				).toEqual(baseline)
				responses.push({
					story: baseline,
					completions: await client.request(`textDocument/completion`, {
						textDocument: { uri: cssUri },
						position: { line: 0, character: 19 },
					}),
					actions: await client.request(`textDocument/codeAction`, {
						textDocument: { uri: cssUri },
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 48 },
						},
						context: { diagnostics: [] },
					}),
				})
			}
			expect(responses[1]).toEqual(responses[0])
			expect(responses[2]).toEqual(responses[0])
		},
	)

	it(`discards canceled and superseded navigation without blocking other requests`, async () => {
		using project = createOfficialAstroProject(files)
		const { filePath } = project.options(source)
		await using client = createLspClient(project.root)
		await client.initialize(enabled)
		client.open(filePath, source)
		const pending = client.request(
			`textDocument/definition`,
			params(filePath, source, `<Renamed`),
		)
		client.cancelLastRequest()
		expect(await pending).toEqual([])
		const stale = client.request(
			`textDocument/definition`,
			params(filePath, source, `<Renamed`),
		)
		client.change(filePath, source.replaceAll(`Renamed`, `Missing`))
		expect(await stale).toEqual([])
		expect(
			await client.request(`lasertag/renderStory`, {
				uri: pathToFileURL(filePath).href,
			}),
		).toEqual({ kind: `outside-context` })
	})
})
