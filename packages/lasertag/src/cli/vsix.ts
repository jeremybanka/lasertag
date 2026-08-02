import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { rolldown, type ExternalOption } from "rolldown"

import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
	LASERTAG_RESTART_SERVER_COMMAND,
	LASERTAG_RESTART_SERVER_TITLE,
} from "../lsp/code-actions.ts"
import {
	LASERTAG_OPEN_RENDER_SOURCE_COMMAND,
	LASERTAG_OPEN_STYLES_COMMAND,
	LASERTAG_RENDER_STORY_VIEW_ID,
} from "../vscode/render-story-tree.ts"

export type LasertagVsixBuildResult = {
	buildRoot: string
	vscodeTarget: string
	vsixPath: string
}

export type LasertagVsixBuildOptions = {
	outdir: string
	packageRoot?: string
	runCommand?: LasertagCommandRunner
}

export type LasertagVscodeInstallRequest = {
	cwd: string
	editorCommand: string
	vsixPath: string
}

export type LasertagVscodeInstallResult = {
	error?: string
	exitCode: number
}

export type LasertagCommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string },
) => Promise<{ exitCode: number }>

type LasertagPackageJson = {
	license: string
	version: string
}

const requireFromVsix = createRequire(import.meta.url)

export function defaultLasertagPackageRoot(): string {
	const modulePath = fileURLToPath(import.meta.url)
	const moduleDirectory = path.dirname(modulePath)

	if (path.basename(path.dirname(moduleDirectory)) === `src`) {
		return path.resolve(moduleDirectory, `..`, `..`)
	}

	return path.resolve(moduleDirectory, `..`)
}

export function resolveCurrentVscodePlatformTarget(
	platform = process.platform,
	arch = process.arch,
): string {
	const targetByPlatform = new Map([
		[`darwin-arm64`, `darwin-arm64`],
		[`darwin-x64`, `darwin-x64`],
		[`linux-arm64`, `linux-arm64`],
		[`linux-x64`, `linux-x64`],
		[`win32-arm64`, `win32-arm64`],
		[`win32-x64`, `win32-x64`],
	])
	const platformKey = `${platform}-${arch}`
	const target = targetByPlatform.get(platformKey)

	if (!target) {
		throw new Error(`Unsupported VSCode extension target ${platformKey}.`)
	}

	return target
}

function resolvePackageRoot(
	packageName: string,
	fromRequire = requireFromVsix,
): string {
	const packageJsonPath = fromRequire.resolve(`${packageName}/package.json`)

	return path.dirname(packageJsonPath)
}

function createVscodeManifest(version: string, license: string) {
	return {
		name: "lasertag-vscode",
		displayName: "Lasertag",
		description:
			"CSS Modules done right: dead selectors, caught from your component's real render story.",
		version,
		publisher: "jeremybanka",
		private: true,
		type: "module",
		repository: {
			type: "git",
			url: "https://github.com/jeremybanka/lasertag.git",
			directory: "packages/lasertag/src/vscode",
		},
		license,
		engines: {
			vscode: "^1.100.0",
		},
		categories: ["Linters", "Programming Languages"],
		activationEvents: [
			"onLanguage:astro",
			"onLanguage:css",
			"onLanguage:typescriptreact",
			`onView:${LASERTAG_RENDER_STORY_VIEW_ID}`,
			"workspaceContains:**/*.module.css",
		],
		extensionKind: ["workspace"],
		icon: "dist/LasertagIcon.png",
		main: "./dist/extension.mjs",
		files: ["dist", "LICENSE", "README.md"],
		contributes: {
			commands: [
				{
					command: LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
					title: LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
				},
				{
					command: LASERTAG_RESTART_SERVER_COMMAND,
					title: LASERTAG_RESTART_SERVER_TITLE,
				},
				{
					command: LASERTAG_OPEN_STYLES_COMMAND,
					icon: `$(symbol-color)`,
					title: `Lasertag: Open Styles`,
				},
				{
					command: LASERTAG_OPEN_RENDER_SOURCE_COMMAND,
					icon: `$(file-code)`,
					title: `Lasertag: Open Render Source`,
				},
			],
			viewsContainers: {
				activitybar: [
					{
						id: `lasertag`,
						icon: `dist/LasertagActivity.svg`,
						title: `Lasertag`,
					},
				],
			},
			views: {
				lasertag: [
					{
						id: LASERTAG_RENDER_STORY_VIEW_ID,
						name: `Render Story`,
						when: `lasertag.inContext`,
					},
				],
			},
			menus: {
				"view/title": [
					{
						command: LASERTAG_OPEN_STYLES_COMMAND,
						group: `navigation@1`,
						when: `view == ${LASERTAG_RENDER_STORY_VIEW_ID} && lasertag.inContext`,
					},
					{
						command: LASERTAG_OPEN_RENDER_SOURCE_COMMAND,
						group: `navigation@2`,
						when: `view == ${LASERTAG_RENDER_STORY_VIEW_ID} && lasertag.inContext`,
					},
				],
			},
			configuration: {
				title: "Lasertag",
				properties: {
					"lasertag.lsp.path": {
						type: "string",
						default: "",
						description:
							"Optional path to a lasertag-lsp executable. Relative paths resolve from the workspace root. Leave empty to use the bundled server.",
					},
					"lasertag.server.path": {
						type: "string",
						default: "",
						description:
							"Optional path to a lasertag-lsp server module. Ignored when lasertag.lsp.path is set.",
					},
					"lasertag.typescript.sdk.path": {
						type: "string",
						default: "",
						description:
							"Optional path to the TypeScript native executable used by the TypeScript 7 SDK. Relative paths resolve from the workspace root. Leave empty to use the bundled native executable.",
					},
					"lasertag.trace.server": {
						type: "string",
						enum: ["off", "messages", "verbose"],
						default: "off",
						description:
							"Trace communication between VSCode and the lasertag language server.",
					},
					"lasertag.log.level": {
						type: "string",
						enum: ["off", "error", "warn", "info", "debug"],
						default: "info",
						description:
							"Controls lasertag language server operational logging. These logs are separate from protocol tracing.",
					},
				},
			},
		},
	}
}

async function copyPackageRoot(packageRoot: string, destination: string) {
	await cp(packageRoot, destination, {
		dereference: true,
		filter(source) {
			const relative = path.relative(packageRoot, source)

			return !relative.split(path.sep).includes("node_modules")
		},
		force: true,
		recursive: true,
	})
}

function resolveTypescriptNativePackageName(
	platform = process.platform,
	arch = process.arch,
): string {
	return `@typescript/typescript-${platform}-${arch}`
}

async function copyTypescriptNativeRuntime(destinationNodeModules: string) {
	const typescriptRoot = resolvePackageRoot("typescript")
	const requireFromTypescript = createRequire(
		path.join(typescriptRoot, "package.json"),
	)
	const nativePackageName = resolveTypescriptNativePackageName()
	const nativePackageRoot = resolvePackageRoot(
		nativePackageName,
		requireFromTypescript,
	)

	await mkdir(path.join(destinationNodeModules, "@typescript"), {
		recursive: true,
	})
	await copyPackageRoot(
		nativePackageRoot,
		path.join(
			destinationNodeModules,
			"@typescript",
			nativePackageName.slice(12),
		),
	)
}

async function copyAstroCompilerRuntime(destinationNodeModules: string) {
	const compilerRoot = resolvePackageRoot("@astrojs/compiler")

	await mkdir(path.join(destinationNodeModules, "@astrojs"), {
		recursive: true,
	})
	await copyPackageRoot(
		compilerRoot,
		path.join(destinationNodeModules, "@astrojs", "compiler"),
	)
}

async function copyVscodeRuntimeDependencies(destinationNodeModules: string) {
	await rm(destinationNodeModules, { force: true, recursive: true })
	await copyTypescriptNativeRuntime(destinationNodeModules)
	await copyAstroCompilerRuntime(destinationNodeModules)
}

async function bundleEntry(options: {
	external: ExternalOption
	input: string
	outfile: string
}) {
	const bundle = await rolldown({
		external: options.external,
		input: options.input,
		onLog(level, log, defaultHandler) {
			defaultHandler(log.code === `UNRESOLVED_IMPORT` ? `error` : level, log)
		},
		platform: "node",
	})

	try {
		await bundle.write({
			file: options.outfile,
			format: "esm",
			sourcemap: true,
		})
	} finally {
		await bundle.close()
	}
}

async function bundleVscodeRuntime(packageRoot: string, distRoot: string) {
	await bundleEntry({
		external: ["vscode"],
		input: path.join(packageRoot, "src", "vscode", "extension.ts"),
		outfile: path.join(distRoot, "extension.mjs"),
	})
	await bundleEntry({
		external: (id) =>
			id.startsWith("@typescript/") || id.startsWith("@astrojs/compiler"),
		input: path.join(packageRoot, "src", "lsp", "server.ts"),
		outfile: path.join(distRoot, "server.mjs"),
	})
}

async function runCommand(
	command: string,
	args: string[],
	options: { cwd: string },
): Promise<{ exitCode: number }> {
	const child = spawn(command, args, {
		cwd: options.cwd,
		stdio: "inherit",
	})

	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject)
		child.on("close", resolve)
	})

	return { exitCode: exitCode ?? 1 }
}

function resolveVsceEntrypoint(): string {
	const vscePackageRoot = resolvePackageRoot("@vscode/vsce")
	const vscePackageJson = requireFromVsix(
		path.join(vscePackageRoot, "package.json"),
	) as { bin?: Record<string, string> }
	const vsceBin = vscePackageJson.bin?.vsce ?? "vsce"

	return path.join(vscePackageRoot, vsceBin)
}

export async function buildLasertagVsix(
	options: LasertagVsixBuildOptions,
): Promise<LasertagVsixBuildResult> {
	const packageRoot = options.packageRoot ?? defaultLasertagPackageRoot()
	const outdir = path.resolve(options.outdir)
	const buildRoot = path.join(outdir, ".lasertag-vsix")
	const packageDist = path.join(buildRoot, "dist")
	const vsixPath = path.join(outdir, "Lasertag.vsix")
	const vscodeTarget = resolveCurrentVscodePlatformTarget()
	const lasertagPackageJson = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf-8"),
	) as LasertagPackageJson

	await rm(buildRoot, { force: true, recursive: true })
	await mkdir(packageDist, { recursive: true })
	await bundleVscodeRuntime(packageRoot, packageDist)
	await cp(
		path.join(packageRoot, "src", "vscode", "LasertagIcon.png"),
		path.join(packageDist, "LasertagIcon.png"),
	)
	await cp(
		path.join(packageRoot, "src", "vscode", "LasertagActivity.svg"),
		path.join(packageDist, "LasertagActivity.svg"),
	)
	await cp(
		path.join(packageRoot, "src", "vscode", "README.md"),
		path.join(buildRoot, "README.md"),
	)
	await cp(path.join(packageRoot, "LICENSE"), path.join(buildRoot, "LICENSE"))
	await copyVscodeRuntimeDependencies(path.join(packageDist, "node_modules"))
	await writeFile(
		path.join(buildRoot, "package.json"),
		`${JSON.stringify(
			createVscodeManifest(
				lasertagPackageJson.version,
				lasertagPackageJson.license,
			),
			null,
			"\t",
		)}\n`,
	)

	const runner = options.runCommand ?? runCommand
	const vsce = await runner(
		process.execPath,
		[
			resolveVsceEntrypoint(),
			"package",
			"--target",
			vscodeTarget,
			"--no-dependencies",
			"--out",
			vsixPath,
		],
		{
			cwd: buildRoot,
		},
	)

	if (vsce.exitCode !== 0) {
		throw new Error(`vsce package exited with code ${vsce.exitCode}.`)
	}

	return { buildRoot, vscodeTarget, vsixPath }
}

export async function installVscodeExtensionWithEditor(
	request: LasertagVscodeInstallRequest,
): Promise<LasertagVscodeInstallResult> {
	const child = spawn(
		request.editorCommand,
		["--install-extension", request.vsixPath, "--force"],
		{
			cwd: request.cwd,
			stdio: "inherit",
		},
	)

	const result = await new Promise<LasertagVscodeInstallResult>((resolve) => {
		child.on("error", (error) => {
			resolve({
				error: error.message,
				exitCode: 1,
			})
		})
		child.on("close", (exitCode, signal) => {
			if (signal) {
				resolve({
					error: `${request.editorCommand} exited from signal ${signal}.`,
					exitCode: 1,
				})
				return
			}

			resolve({
				exitCode: exitCode ?? 1,
			})
		})
	})

	return result
}
