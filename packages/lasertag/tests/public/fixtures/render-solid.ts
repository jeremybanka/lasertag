import { createRequire } from "node:module"

import { transformSync } from "@babel/core"
import { renderToString } from "solid-js/web"

const require = createRequire(import.meta.url)

export async function renderSolid(source: string): Promise<string> {
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
	if (!compiled?.code) throw new Error(`Solid compilation produced no code`)
	const executable = compiled.code.replaceAll(
		/from "(solid-js(?:\/[^"\n]+)?)"/g,
		(_, specifier: string) =>
			`from ${JSON.stringify(import.meta.resolve(specifier))}`,
	)
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString(`base64`)}`
	const module = await import(/* @vite-ignore */ moduleUrl)
	return renderToString(
		module.render ?? (() => (module.default ?? module.AppPanel)({})),
	)
}
