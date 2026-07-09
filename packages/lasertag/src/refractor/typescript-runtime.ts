export const LASERTAG_TYPESCRIPT_SDK_PATH = `LASERTAG_TYPESCRIPT_SDK_PATH`

export type TypescriptRuntimeEnvironment = Record<string, string | undefined>

export type TypescriptRuntimeOptions = {
	environment?: TypescriptRuntimeEnvironment
	typescriptSdkPath?: string
}

export function resolveTypescriptSdkPath({
	environment = process.env,
	typescriptSdkPath,
}: TypescriptRuntimeOptions = {}): string | undefined {
	const configuredPath =
		typescriptSdkPath?.trim() ||
		environment[LASERTAG_TYPESCRIPT_SDK_PATH]?.trim()

	return configuredPath || undefined
}
