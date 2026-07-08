import { chmod, copyFile, mkdir, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptRoot, "..")
const workspaceRoot = path.resolve(extensionRoot, "..", "..")
const distRoot = path.join(extensionRoot, "dist")

async function run(command, args) {
	const child = spawn(command, args, {
		cwd: extensionRoot,
		stdio: "inherit",
	})
	const exitCode = await new Promise((resolve) => {
		child.on("close", resolve)
	})

	if (exitCode !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`)
	}
}

await rm(distRoot, { force: true, recursive: true })
await mkdir(path.join(distRoot, "server"), { recursive: true })
await copyFile(
	path.join(workspaceRoot, "LasertagIcon.png"),
	path.join(distRoot, "LasertagIcon.png"),
)

await run("rolldown", [
	"extension.js",
	"--platform",
	"node",
	"--format",
	"cjs",
	"--external",
	"vscode",
	"--file",
	path.join(distRoot, "extension.cjs"),
])

await run("rolldown", [
	path.join(workspaceRoot, "packages", "lasertag", "lsp", "src", "server.ts"),
	"--platform",
	"node",
	"--format",
	"esm",
	"--file",
	path.join(distRoot, "server", "lsp.mjs"),
	"--tsconfig",
	path.join(workspaceRoot, "tsconfig.json"),
])

await chmod(path.join(distRoot, "server", "lsp.mjs"), 0o755)

console.log(`bundled lasertag VSCode extension into ${distRoot}`)
