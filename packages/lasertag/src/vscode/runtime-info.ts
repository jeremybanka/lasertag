import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Query the selected executable, including overrides, without opening a project. */
export async function typescriptRuntimeVersion(
	executable: string,
): Promise<string> {
	const { stdout } = await execFileAsync(executable, [`--version`], {
		timeout: 2_000,
		killSignal: `SIGKILL`,
		maxBuffer: 4_096,
		windowsHide: true,
	})
	const version = /^Version\s+(\S+)\s*$/u.exec(stdout.trim())?.[1]
	if (!version) throw new Error(`Unrecognized TypeScript version response`)
	return version
}
