import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

type SpawnResult = {
	exitCode: number
}

type LasertagPackageJson = {
	version: string
}

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptsRoot, "..")
const vscodeRoot = path.resolve(packageRoot, "vscode")
const packageDist = path.join(packageRoot, "dist")
const vsixPath = path.join(packageDist, "Lasertag.vsix")
const vscodePackageJsonPath = path.join(vscodeRoot, "package.json")
const vsceBin = path.join(
	packageRoot,
	"node_modules",
	"@vscode",
	"vsce",
	"vsce",
)

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
	main: "./dist/extension.cjs",
	files: ["dist", "README.md"],
	contributes: {
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

const vsce = await run(
	process.execPath,
	[
		vsceBin,
		"package",
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
