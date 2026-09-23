import { createRequire } from "node:module"

import { transformSync } from "@babel/core"
import { renderToString } from "solid-js/web"
import { afterAll, expect, it } from "vite-plus/test"

import {
	createTypescriptAstSession,
	validateCssReachability,
} from "../../../src/refractor/index.ts"
import { conservativeJsxCss } from "../fixtures/conservative-jsx.ts"
import { solidPropPrecedenceCases } from "../fixtures/solid-prop-precedence.ts"

const require = createRequire(import.meta.url)
const session = createTypescriptAstSession()
afterAll(() => session.close())

it.each(solidPropPrecedenceCases)(
	`matches compiled Solid SSR output: $name`,
	async ({ source, rendersAside }) => {
		const compiled = transformSync(source, {
			filename: `AppPanel.jsx`,
			babelrc: false,
			configFile: false,
			presets: [
				[
					require.resolve(`babel-preset-solid`),
					{ generate: `ssr`, hydratable: false },
				],
			],
		})
		expect(compiled?.code).toBeTruthy()
		const executable = compiled!.code!.replaceAll(
			/from "(solid-js(?:\/[^"\n]+)?)"/g,
			(_, specifier: string) =>
				`from ${JSON.stringify(import.meta.resolve(specifier))}`,
		)
		const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString(`base64`)}`
		const { render } = await import(/* @vite-ignore */ moduleUrl)
		const html = renderToString(render)
		expect(html).toMatch(/^<app-panel\b[^>]*class="class\s*"[^>]*>/)
		expect(html.replace(/^<app-panel\b[^>]*>/, `<app-panel>`)).toBe(
			`<app-panel>${rendersAside ? `<aside></aside>` : ``}</app-panel>`,
		)

		const { diagnostics } = validateCssReachability(
			{
				tsxPath: `/project/AppPanel.tsx`,
				tsxSource: source,
				cssPath: `/project/AppPanel.module.css`,
				cssSource: conservativeJsxCss,
			},
			session,
		)
		expect(
			diagnostics.filter(({ code }) => code === `dead-selector`),
		).toHaveLength(rendersAside ? 0 : 1)
	},
)
