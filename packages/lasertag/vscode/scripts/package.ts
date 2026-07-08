import { spawn } from "node:child_process"
import { copyFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptRoot, "..")
const lasertagPackageRoot = path.resolve(extensionRoot, "..")
const workspaceRoot = path.resolve(lasertagPackageRoot, "..", "..")
const artifactsRoot = path.join(workspaceRoot, "artifacts")
const packageJson = JSON.parse(
	await readFile(path.join(extensionRoot, "package.json"), "utf-8"),
)
const vsixPath = path.join(
	artifactsRoot,
	`lasertag-vscode-${packageJson.version}.vsix`,
)
const lasertagPackageVsixPath = path.join(
	lasertagPackageRoot,
	"dist",
	"vscode",
	"Lasertag.vsix",
)

await mkdir(artifactsRoot, { recursive: true })
await mkdir(path.dirname(lasertagPackageVsixPath), { recursive: true })

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
	await copyFile(vsixPath, lasertagPackageVsixPath)
	console.log(`created ${vsixPath}`)
	console.log(`synced ${lasertagPackageVsixPath}`)
}
