import path from "node:path"
import { pathToFileURL } from "node:url"

import { expect, it } from "vite-plus/test"

import type { LasertagRenderStoryView } from "../../../src/lsp/render-story-view.ts"
import { createCssMapperProject } from "./fixtures/css-project.ts"
import { createLspClient } from "./helpers/client.ts"

const enabled = { cssOwnership: { enabled: true, runExternalCode: true } }
const source = `import css from "./AppPanel.module.css"; export const AppPanel = () => <app-panel className={css.class}><span /></app-panel>`
const css = `app-panel.class { > span {} > missing {} }\n.extra {}`

it(`does not run mapped analysis for documents outside the configured workspace`, async () => {
	using workspace = createCssMapperProject()
	using outside = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
	})
	await using client = createLspClient(workspace.root)
	await client.initialize(enabled)
	const sourcePath = path.join(outside.root, `AppPanel.tsx`)
	client.open(sourcePath, source, `typescriptreact`)
	const view = await client.request(`lasertag/renderStory`, {
		uri: pathToFileURL(sourcePath).href,
	})
	expect(view).not.toHaveProperty(`ownership`)
})

it(`discards a mapped story superseded by an edit and honors cancellation`, async () => {
	using project = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
		"Other.module.css": `.class {}`,
	})
	await using client = createLspClient(project.root)
	await client.initialize(enabled)
	const sourcePath = path.join(project.root, `AppPanel.tsx`)
	const params = { uri: pathToFileURL(sourcePath).href }
	client.open(sourcePath, source, `typescriptreact`)
	const stale = client.request(`lasertag/renderStory`, params)
	client.change(
		sourcePath,
		source.replace(`./AppPanel.module.css`, `./Other.module.css`),
	)
	expect(await stale).toEqual({ kind: `outside-context` })
	expect(await client.request(`lasertag/renderStory`, params)).toMatchObject({
		ownership: { attachments: [{ status: `foreign` }] },
	})
	client.change(sourcePath, `${source}\n// another edit`, 3)
	const canceled = client.request(`lasertag/renderStory`, params)
	client.cancelLastRequest()
	expect(await canceled).toEqual({ kind: `outside-context` })
	expect(await client.request(`lasertag/renderStory`, params)).toMatchObject({
		ownership: { attachments: [{ status: `sibling` }] },
	})
})

it.each([
	{},
	{ cssOwnership: { enabled: true } },
	{ cssOwnership: { runExternalCode: true } },
])(`requires both CSS mapper opt-in flags: %j`, async (options) => {
	using project = createCssMapperProject({
		"AppPanel.tsx": source,
		"AppPanel.module.css": css,
	})
	await using client = createLspClient(project.root)
	await client.initialize(options)
	const sourcePath = path.join(project.root, `AppPanel.tsx`)
	client.open(sourcePath, source, `typescriptreact`)
	const view = await client.request(`lasertag/renderStory`, {
		uri: pathToFileURL(sourcePath).href,
	})
	expect(view).toMatchObject({ kind: `ready` })
	expect(view).not.toHaveProperty(`ownership`)
})

it.each([`tsx`, `astro`])(
	`uses mapped %s stories for views, completions and cleanup with identical structural results`,
	async (extension) => {
		const text =
			extension === `tsx`
				? source
				: `---\nimport css from "./AppPanel.module.css"\n---\n<app-panel class={css.class}><span /></app-panel>`
		using project = createCssMapperProject({
			[`AppPanel.${extension}`]: text,
			"AppPanel.module.css": css,
		})
		const sourcePath = path.join(project.root, `AppPanel.${extension}`)
		const cssPath = path.join(project.root, `AppPanel.module.css`)
		const uri = pathToFileURL(cssPath).href
		await using ordinary = createLspClient(project.root)
		await using mapped = createLspClient(project.root)
		await ordinary.initialize()
		await mapped.initialize(enabled)
		for (const client of [ordinary, mapped]) {
			client.open(
				sourcePath,
				text,
				extension === `tsx` ? `typescriptreact` : `astro`,
			)
			client.open(cssPath, css, `css`)
		}
		const expected = await ordinary.request(`lasertag/renderStory`, { uri })
		const view = await mapped.request<LasertagRenderStoryView>(
			`lasertag/renderStory`,
			{ uri },
		)
		expect(view.kind).toBe(`ready`)
		if (view.kind !== `ready`) throw new Error(`No story`)
		const { ownership, ...structure } = view
		expect(structure).toEqual(expected)
		expect(ownership).toMatchObject({
			status: `available`,
			attachments: [{ status: `sibling` }],
		})
		for (const [method, params] of [
			[
				`textDocument/completion`,
				{ textDocument: { uri }, position: { line: 0, character: 18 } },
			],
			[
				`textDocument/codeAction`,
				{
					textDocument: { uri },
					range: {
						start: { line: 0, character: 0 },
						end: { line: 1, character: 9 },
					},
					context: { diagnostics: [] },
				},
			],
		] as const)
			expect(await mapped.request(method, params)).toEqual(
				await ordinary.request(method, params),
			)

		const editedCss = `/* 🌱 updated */\n${css}`
		mapped.change(cssPath, editedCss)
		const edited = await mapped.request<LasertagRenderStoryView>(
			`lasertag/renderStory`,
			{ uri },
		)
		if (edited.kind !== `ready` || edited.ownership?.status !== `available`)
			throw new Error(`No ownership`)
		const target = edited.ownership.attachments[0]!.targets[0]!
		expect(target.range!.start).toBe(editedCss.indexOf(`class`))
		mapped.close(cssPath)
		const restored = await mapped.request<LasertagRenderStoryView>(
			`lasertag/renderStory`,
			{ uri: pathToFileURL(sourcePath).href },
		)
		if (restored.kind !== `ready` || restored.ownership?.status !== `available`)
			throw new Error(`No restored ownership`)
		expect(restored.ownership.attachments[0]!.targets[0]!.range!.start).toBe(
			css.indexOf(`class`),
		)
	},
)

it(`refreshes imported bindings and configuration without changing the structural story`, async () => {
	const text = source.replace(`"./AppPanel.module.css"`, `"./binding"`)
	using project = createCssMapperProject({
		"AppPanel.tsx": text,
		"AppPanel.module.css": css,
		"Other.module.css": `.class {}`,
		"binding.ts": `export { default } from "./AppPanel.module.css"`,
	})
	await using client = createLspClient(project.root)
	await client.initialize(enabled)
	const sourcePath = path.join(project.root, `AppPanel.tsx`)
	client.open(sourcePath, text, `typescriptreact`)
	const query = () =>
		client.request<LasertagRenderStoryView>(`lasertag/renderStory`, {
			uri: pathToFileURL(sourcePath).href,
		})
	expect(await query()).toMatchObject({
		ownership: { attachments: [{ status: `sibling` }] },
	})
	const binding = path.join(project.root, `binding.ts`)
	client.open(
		binding,
		`export { default } from "./Other.module.css"`,
		`typescript`,
	)
	expect(await query()).toMatchObject({
		ownership: { attachments: [{ status: `foreign` }] },
	})
	client.close(binding)
	expect(await query()).toMatchObject({
		ownership: { attachments: [{ status: `sibling` }] },
	})
	const config = project.write(
		`tsconfig.json`,
		JSON.stringify({ compilerOptions: { jsx: `preserve` } }),
	)
	client.notify(`workspace/didChangeWatchedFiles`, {
		changes: [{ uri: pathToFileURL(config).href, type: 2 }],
	})
	const view = await query()
	if (view.kind !== `ready` || view.ownership?.status !== `available`)
		throw new Error(`No analysis`)
	expect(view.ownership.attachments[0]!.status).not.toBe(`sibling`)
})
