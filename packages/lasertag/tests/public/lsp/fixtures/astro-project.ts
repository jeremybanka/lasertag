import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const officialAstroMapperPath = path.dirname(
	fileURLToPath(import.meta.resolve(`@astrojs/ts-content-mapper/package.json`)),
)

/** Run the unmodified Astro mapper in an isolated configured project. */
export function createOfficialAstroProject(files: Record<string, string> = {}) {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-official-astro-`))
	function write(name: string, source: string) {
		const filePath = path.join(root, name)
		mkdirSync(path.dirname(filePath), { recursive: true })
		writeFileSync(filePath, source)
		return filePath
	}

	// Ambient types resolve just as they do for a normal installed project.
	symlinkSync(
		fileURLToPath(new URL(`../../../../node_modules`, import.meta.url)),
		path.join(root, `node_modules`),
		`junction`,
	)
	write(
		`tsconfig.json`,
		JSON.stringify({
			compilerOptions: {
				jsx: `preserve`,
				module: `esnext`,
				moduleResolution: `bundler`,
				allowImportingTsExtensions: true,
				noEmit: true,
				paths: { "ui/*": [`./components/*`] },
			},
			contentMappers: [
				{ package: officialAstroMapperPath, extensions: [`.astro`] },
			],
		}),
	)
	for (const [name, source] of Object.entries(files)) write(name, source)

	return {
		root,
		write,
		options(sourceText: string, name = `AppPanel.astro`) {
			return {
				filePath: write(name, sourceText),
				sourceText,
				runExternalCode: true,
			}
		},
		[Symbol.dispose]() {
			rmSync(root, { recursive: true, force: true })
		},
	}
}
