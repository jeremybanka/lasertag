import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
	buildLasertagVsix,
	resolveCurrentVscodePlatformTarget,
} from "../../src/cli/vsix.ts"

const fixtureRoots: string[] = []

function createFixture(files: Record<string, string>) {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-vsix-`))

	fixtureRoots.push(root)

	for (const [filePath, sourceText] of Object.entries(files)) {
		const absolutePath = path.join(root, filePath)

		mkdirSync(path.dirname(absolutePath), { recursive: true })
		writeFileSync(absolutePath, sourceText)
	}

	return {
		path: (filePath: string) => path.join(root, filePath),
		root,
	}
}

describe(`lasertag vsix builder`, () => {
	afterEach(() => {
		for (const root of fixtureRoots.splice(0)) {
			rmSync(root, { force: true, recursive: true })
		}
	})

	it(`resolves supported VSCode platform targets`, () => {
		expect(resolveCurrentVscodePlatformTarget(`darwin`, `arm64`)).toBe(
			`darwin-arm64`,
		)
		expect(resolveCurrentVscodePlatformTarget(`linux`, `x64`)).toBe(`linux-x64`)
		expect(resolveCurrentVscodePlatformTarget(`win32`, `arm64`)).toBe(
			`win32-arm64`,
		)
	})

	it(`errors clearly on unsupported VSCode platform targets`, () => {
		expect(() => resolveCurrentVscodePlatformTarget(`freebsd`, `x64`)).toThrow(
			`Unsupported VSCode extension target freebsd-x64.`,
		)
	})

	it(`ships the VSCode language client needed to build the extension`, () => {
		const packageJson = JSON.parse(
			readFileSync(
				path.resolve(import.meta.dirname, `../../package.json`),
				`utf-8`,
			),
		) as {
			dependencies?: Record<string, string>
			devDependencies?: Record<string, string>
		}

		expect(packageJson.dependencies).toHaveProperty(`vscode-languageclient`)
		expect(packageJson.devDependencies).not.toHaveProperty(
			`vscode-languageclient`,
		)
	})

	it(`fails rather than externalizing unresolved VSIX runtime imports`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `9.8.7-test` }),
			"src/lsp/server.ts": ``,
			"src/vscode/extension.ts": `import "missing-vsix-runtime"`,
			"src/vscode/LasertagActivity.svg": ``,
			"src/vscode/LasertagIcon.png": ``,
			"src/vscode/README.md": `# Lasertag`,
		})
		let packaged = false

		await expect(
			buildLasertagVsix({
				outdir: fixture.path(`out`),
				packageRoot: fixture.root,
				runCommand: async () => {
					packaged = true

					return { exitCode: 0 }
				},
			}),
		).rejects.toThrow(`Could not resolve 'missing-vsix-runtime'`)
		expect(packaged).toBe(false)
	})

	it(`writes the VSCode manifest and copies its analysis runtimes`, async () => {
		const fixture = createFixture({
			LICENSE: `fixture license`,
			"package.json": JSON.stringify({
				license: `MPL-2.0`,
				version: `9.8.7-test`,
			}),
			"src/vscode/extension.ts": `
				export function activate() {}
				export function deactivate() {}
			`,
			"src/vscode/README.md": `# Lasertag`,
			"src/vscode/LasertagActivity.svg": ``,
			"src/vscode/LasertagIcon.png": ``,
			"src/lsp/server.ts": `console.log("server")`,
		})
		const commands: Array<{ args: string[]; cwd: string }> = []
		const result = await buildLasertagVsix({
			outdir: fixture.path(`out`),
			packageRoot: fixture.root,
			runCommand: async (_command, args, options) => {
				commands.push({ args, cwd: options.cwd })
				writeFileSync(fixture.path(`out/Lasertag.vsix`), `fake vsix`)
				return { exitCode: 0 }
			},
		})
		const manifest = JSON.parse(
			readFileSync(path.join(result.buildRoot, `package.json`), `utf-8`),
		) as {
			contributes: {
				configuration: { properties: Record<string, unknown> }
				views: Record<string, Array<{ id: string }>>
				viewsContainers: { activitybar: Array<{ id: string }> }
			}
			files: string[]
			license: string
			main: string
			version: string
		}
		const nativeRuntimePath = path.join(
			result.buildRoot,
			`dist/node_modules/@typescript/typescript-${process.platform}-${process.arch}`,
		)
		const astroCompilerPath = path.join(
			result.buildRoot,
			`dist/node_modules/@astrojs/compiler`,
		)

		expect(result.vsixPath).toBe(fixture.path(`out/Lasertag.vsix`))
		expect(result.vscodeTarget).toBe(
			resolveCurrentVscodePlatformTarget(process.platform, process.arch),
		)
		expect(manifest.version).toBe(`9.8.7-test`)
		expect(manifest.files).toContain(`LICENSE`)
		expect(manifest.license).toBe(`MPL-2.0`)
		expect(manifest.main).toBe(`./dist/extension.mjs`)
		expect(
			manifest.contributes.configuration.properties[
				`lasertag.typescript.sdk.path`
			],
		).toMatchObject({
			default: ``,
			type: `string`,
		})
		expect(manifest.contributes.viewsContainers.activitybar).toContainEqual(
			expect.objectContaining({ id: `lasertag` }),
		)
		expect(manifest.contributes.views.lasertag).toContainEqual(
			expect.objectContaining({ id: `lasertag.renderStory` }),
		)
		expect(existsSync(path.join(result.buildRoot, `dist/extension.mjs`))).toBe(
			true,
		)
		expect(
			existsSync(path.join(result.buildRoot, `dist/extension.mjs.map`)),
		).toBe(true)
		expect(
			existsSync(path.join(result.buildRoot, `dist/LasertagActivity.svg`)),
		).toBe(true)
		expect(existsSync(path.join(result.buildRoot, `LICENSE`))).toBe(true)
		expect(existsSync(path.join(astroCompilerPath, `dist/astro.wasm`))).toBe(
			true,
		)
		expect(existsSync(path.join(result.buildRoot, `dist/server.mjs`))).toBe(
			true,
		)
		expect(existsSync(path.join(result.buildRoot, `dist/server.mjs.map`))).toBe(
			true,
		)
		expect(
			existsSync(path.join(result.buildRoot, `dist/node_modules/typescript`)),
		).toBe(false)
		expect(existsSync(nativeRuntimePath)).toBe(true)
		expect(existsSync(path.join(nativeRuntimePath, `lib`, `tsc`))).toBe(
			process.platform !== `win32`,
		)
		expect(existsSync(path.join(nativeRuntimePath, `lib`, `tsc.exe`))).toBe(
			process.platform === `win32`,
		)
		expect(commands).toHaveLength(1)
		expect(commands[0]?.cwd).toBe(result.buildRoot)
		expect(commands[0]?.args).toContain(`--no-dependencies`)
		expect(commands[0]?.args).not.toContain(`--skip-license`)
		expect(commands[0]?.args).toContain(result.vsixPath)
	})
})
