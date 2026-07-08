import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptRoot, "..")
const workspaceRoot = path.resolve(extensionRoot, "..", "..")
const artifactsRoot = path.join(workspaceRoot, "artifacts")
const packageJson = JSON.parse(
	await readFile(path.join(extensionRoot, "package.json"), "utf-8"),
)
const vsixPath = path.join(
	artifactsRoot,
	`lasertag-vscode-${packageJson.version}.vsix`,
)

await mkdir(artifactsRoot, { recursive: true })

const vsce = spawn(
	"vsce",
	["package", "--no-dependencies", "--skip-license", "--out", vsixPath],
	{
		cwd: extensionRoot,
		stdio: "inherit",
	},
)

const exitCode = await new Promise((resolve) => {
	vsce.on("close", resolve)
})

if (exitCode !== 0) {
	process.exitCode = typeof exitCode === "number" ? exitCode : 1
} else {
	console.log(`created ${vsixPath}`)
}
