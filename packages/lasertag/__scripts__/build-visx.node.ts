import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_TITLE,
	LASERTAG_RESTART_SERVER_COMMAND,
	LASERTAG_RESTART_SERVER_TITLE,
} from "../lsp/src/code-actions.ts"

type SpawnResult = {
	exitCode: number
}

type LasertagPackageJson = {
	version: string
}

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptsRoot, "..")
const vscodeRoot = path.resolve(packageRoot, "vscode")
const vscodeDist = path.join(vscodeRoot, "dist")
const packageDist = path.join(packageRoot, "dist")
const vsixPath = path.join(packageDist, "Lasertag.vsix")
const vscodePackageJsonPath = path.join(vscodeRoot, "package.json")
const runtimeNodeModules = path.join(vscodeDist, "node_modules")
const vsceBin = path.join(
	packageRoot,
	"node_modules",
	"@vscode",
	"vsce",
	"vsce",
)
const requireFromScript = createRequire(import.meta.url)

function resolveVscodeTarget(): string {
	const targetByPlatform = new Map([
		[`darwin-arm64`, `darwin-arm64`],
		[`darwin-x64`, `darwin-x64`],
		[`linux-arm64`, `linux-arm64`],
		[`linux-x64`, `linux-x64`],
		[`win32-arm64`, `win32-arm64`],
		[`win32-x64`, `win32-x64`],
	])
	const platformKey = `${process.platform}-${process.arch}`
	const target = targetByPlatform.get(platformKey)

	if (!target) {
		throw new Error(`Unsupported VSCode extension target ${platformKey}.`)
	}

	return target
}

function resolvePackageRoot(
	packageName: string,
	fromRequire = requireFromScript,
): string {
	const packageJsonPath = fromRequire.resolve(`${packageName}/package.json`)

	return path.dirname(packageJsonPath)
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

async function copyTypescriptRuntime() {
	const typescriptRoot = resolvePackageRoot("typescript")
	const requireFromTypescript = createRequire(
		path.join(typescriptRoot, "package.json"),
	)
	const nativePackageName = `@typescript/typescript-${process.platform}-${process.arch}`
	const nativePackageRoot = resolvePackageRoot(
		nativePackageName,
		requireFromTypescript,
	)

	await rm(runtimeNodeModules, { force: true, recursive: true })
	await mkdir(path.join(runtimeNodeModules, "@typescript"), { recursive: true })
	await copyPackageRoot(
		typescriptRoot,
		path.join(runtimeNodeModules, "typescript"),
	)
	await cp(
		nativePackageRoot,
		path.join(runtimeNodeModules, "@typescript", nativePackageName.slice(12)),
		{
			dereference: true,
			force: true,
			recursive: true,
		},
	)
}

async function run(
	command: string,
	args: string[],
	options: { cwd: string },
): Promise<SpawnResult> {
	const child = spawn(command, args, {
		cwd: options.cwd,
		stdio: "inherit",
	})

	const exitCode = await new Promise<number | null>((resolve) => {
		child.on("close", resolve)
	})

	return { exitCode: exitCode ?? 1 }
}

const lasertagPackageJson = JSON.parse(
	await readFile(path.join(packageRoot, "package.json"), "utf-8"),
) as LasertagPackageJson
const vscodeTarget = resolveVscodeTarget()

const vscodeManifest = {
	name: "lasertag-vscode",
	displayName: "Lasertag",
	description:
		"CSS Modules done right: dead selectors, caught from your component's real render story.",
	version: lasertagPackageJson.version,
	publisher: "jeremybanka",
	private: true,
	type: "module",
	repository: {
		type: "git",
		url: "https://github.com/jeremybanka/lasertag.git",
		directory: "packages/lasertag/vscode",
	},
	license: "MIT",
	engines: {
		vscode: "^1.100.0",
	},
	categories: ["Linters", "Programming Languages"],
	activationEvents: [
		"onLanguage:css",
		"onLanguage:typescriptreact",
		"workspaceContains:**/*.module.css",
	],
	extensionKind: ["workspace"],
	icon: "dist/LasertagIcon.png",
	main: "./dist/extension.mjs",
	files: ["dist", "README.md"],
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
		],
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
						"Optional path to the TypeScript native executable used by the TypeScript 7 SDK. Relative paths resolve from the workspace root.",
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

await mkdir(packageDist, { recursive: true })
await writeFile(
	vscodePackageJsonPath,
	`${JSON.stringify(vscodeManifest, null, "\t")}\n`,
)
await copyTypescriptRuntime()

const vsce = await run(
	process.execPath,
	[
		vsceBin,
		"package",
		"--target",
		vscodeTarget,
		"--no-dependencies",
		"--skip-license",
		"--out",
		vsixPath,
	],
	{
		cwd: vscodeRoot,
	},
)

if (vsce.exitCode !== 0) {
	process.exitCode = vsce.exitCode
} else {
	console.log(`created ${vsixPath}`)
}
