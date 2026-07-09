import path from "node:path"

import { LASERTAG_TYPESCRIPT_SDK_PATH } from "../refractor/src/typescript-runtime.ts"

export { LASERTAG_TYPESCRIPT_SDK_PATH }

export function resolveWorkspacePath(
	configuredPath: string,
	workspaceRoot: string | undefined,
): string | undefined {
	const trimmedPath = configuredPath.trim()

	if (!trimmedPath) return undefined
	if (path.isAbsolute(trimmedPath)) return trimmedPath

	return workspaceRoot ? path.join(workspaceRoot, trimmedPath) : trimmedPath
}

export function resolveBundledTypescriptSdkPath(
	extensionRoot: string,
	platform = process.platform,
	arch = process.arch,
): string {
	const executableName = platform === `win32` ? `tsc.exe` : `tsc`

	return path.join(
		extensionRoot,
		`dist`,
		`node_modules`,
		`@typescript`,
		`typescript-${platform}-${arch}`,
		`lib`,
		executableName,
	)
}

export function resolveTypescriptSdkPath(
	configuredPath: string,
	workspaceRoot: string | undefined,
	bundledPath: string,
): string {
	return resolveWorkspacePath(configuredPath, workspaceRoot) ?? bundledPath
}

export function withTypescriptSdkPathEnvironment(
	environment: NodeJS.ProcessEnv,
	typescriptSdkPath: string | undefined,
): NodeJS.ProcessEnv {
	if (!typescriptSdkPath) return environment

	return {
		...environment,
		[LASERTAG_TYPESCRIPT_SDK_PATH]: typescriptSdkPath,
	}
}
