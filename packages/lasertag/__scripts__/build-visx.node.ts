import { spawn } from "node:child_process"
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

type SpawnResult = {
	exitCode: number
}

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptsRoot, "..")
const vscodeRoot = path.resolve(packageRoot, "vscode")
const vscodeDist = path.join(packageRoot, "dist", "vscode")
const vsixPath = path.join(vscodeDist, "Lasertag.vsix")
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

await mkdir(vscodeDist, { recursive: true })

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
	await copyFile(vsixPath, vsixPath)
	console.log(`created ${vsixPath}`)
	console.log(`synced ${vsixPath}`)
}
