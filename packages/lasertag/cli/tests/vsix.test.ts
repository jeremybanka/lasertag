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
} from "../src/vsix.ts"

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

	it(`writes the VSCode manifest and copies the TypeScript native runtime package`, async () => {
		const fixture = createFixture({
			"package.json": JSON.stringify({ version: `9.8.7-test` }),
			"vscode/extension.ts": `
				export function activate() {}
				export function deactivate() {}
			`,
			"vscode/README.md": `# Lasertag`,
			"vscode/LasertagIcon.png": ``,
			"lsp/src/server.ts": `console.log("server")`,
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
			contributes: { configuration: { properties: Record<string, unknown> } }
			main: string
			version: string
		}
		const nativeRuntimePath = path.join(
			result.buildRoot,
			`dist/node_modules/@typescript/typescript-${process.platform}-${process.arch}`,
		)

		expect(result.vsixPath).toBe(fixture.path(`out/Lasertag.vsix`))
		expect(result.vscodeTarget).toBe(
			resolveCurrentVscodePlatformTarget(process.platform, process.arch),
		)
		expect(manifest.version).toBe(`9.8.7-test`)
		expect(manifest.main).toBe(`./dist/extension.mjs`)
		expect(
			manifest.contributes.configuration.properties[
				`lasertag.typescript.sdk.path`
			],
		).toMatchObject({
			default: ``,
			type: `string`,
		})
		expect(existsSync(path.join(result.buildRoot, `dist/extension.mjs`))).toBe(
			true,
		)
		expect(existsSync(path.join(result.buildRoot, `dist/server.mjs`))).toBe(
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
		expect(commands[0]?.args).toContain(`--skip-license`)
		expect(commands[0]?.args).toContain(result.vsixPath)
	})
})
