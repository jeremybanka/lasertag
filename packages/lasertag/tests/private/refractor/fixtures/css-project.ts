import path from "node:path"
import { fileURLToPath } from "node:url"

import {
	createOfficialAstroProject,
	officialAstroMapperPath,
} from "../../../public/lsp/fixtures/astro-project.ts"

export const cssMapperPath = path.dirname(
	fileURLToPath(import.meta.resolve(`css-modules-content-mapper/package.json`)),
)

/** Real CSS and Astro mappers, enabled only inside this temporary project. */
export function createCssMapperProject(
	files: Record<string, string> = {},
	configured = true,
) {
	const project = createOfficialAstroProject(files)
	project.write(
		`tsconfig.json`,
		JSON.stringify({
			compilerOptions: {
				jsx: `preserve`,
				module: `esnext`,
				moduleResolution: `bundler`,
				allowImportingTsExtensions: true,
				allowSyntheticDefaultImports: true,
				noEmit: true,
				paths: { "styles/*": [`./styles/*`] },
			},
			contentMappers: [
				{ package: officialAstroMapperPath, extensions: [`.astro`] },
				...(configured
					? [{ package: cssMapperPath, extensions: [`.module.css`] }]
					: []),
			],
		}),
	)
	return project
}
