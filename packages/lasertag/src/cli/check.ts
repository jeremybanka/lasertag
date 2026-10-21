import {
	createCliCssAnalysis,
	currentCssAnalysis,
	type PreparedCssAnalysis,
} from "./css-analysis.ts"
import { validateCssAnalysis } from "../refractor/css-analysis.ts"
import type { CssOwnershipResult } from "../refractor/css-ownership-evidence.ts"
import { existsSync, readFileSync } from "node:fs"

import {
	ambiguousRenderSourceMessage,
	createTypescriptAstSession,
	resolveSiblingRenderSource,
	type CssReachabilityDiagnostic,
	type TypescriptAstSession,
} from "../refractor/index.ts"
import {
	runWorkStealing,
	type LasertagWorkResult,
	type LasertagWorkTask,
} from "./work-stealing.ts"

export type LasertagCheckFileStatus = `checked` | `failed` | `skipped`

export type LasertagCheckFileResult = LasertagWorkResult & {
	ownership?: CssOwnershipResult[`ownership`]
	diagnostics: CssReachabilityDiagnostic[]
	status: LasertagCheckFileStatus
	error?: string
	tsxPath?: string
}

export type LasertagCheckResult = {
	diagnostics: Array<{
		cssPath: string
		diagnostic: CssReachabilityDiagnostic
		tsxPath: string
	}>
	failures: LasertagCheckFileResult[]
	fileResults: LasertagCheckFileResult[]
	stealCount: number
	workerCount: number
}

export type LasertagCheckFileSystem = {
	fileExists: (filePath: string) => boolean
	readFile: (filePath: string) => string
}

export type RunLasertagCheckOptions = {
	fileSystem?: Partial<LasertagCheckFileSystem>
	includeStoryEvidence?: boolean
	typescriptSdkPath?: string
	workerCount?: number
	workerModuleUrl?: string | URL
}

const defaultFileSystem: LasertagCheckFileSystem = {
	fileExists: existsSync,
	readFile: (filePath) => readFileSync(filePath, `utf-8`),
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function checkFile(
	task: LasertagWorkTask,
	workerId: number,
	fileSystem: LasertagCheckFileSystem,
	typescriptSession: TypescriptAstSession,
	prepared?: PreparedCssAnalysis,
): LasertagCheckFileResult {
	const { cssPath, index, stolenFrom } = task
	const assignment = stolenFrom === undefined ? {} : { stolenFrom }
	let sourcePath: string | undefined

	try {
		const resolution = resolveSiblingRenderSource(
			cssPath,
			fileSystem.fileExists,
		)

		if (resolution.kind === `missing`) {
			return {
				cssPath,
				diagnostics: [],
				index,
				status: `skipped`,
				...assignment,
				workerId,
			}
		}
		if (resolution.kind === `ambiguous`) {
			throw new Error(ambiguousRenderSourceMessage(cssPath, resolution.sources))
		}

		sourcePath = resolution.source.path

		const cssSource = fileSystem.readFile(cssPath)
		const sourceText = fileSystem.readFile(sourcePath)
		const mapped = currentCssAnalysis(
			prepared,
			sourcePath,
			sourceText,
			cssSource,
		)
		const diagnostics = validateCssAnalysis(
			{
				cssPath,
				cssSource,
				...(task.includeStoryEvidence ? { includeStoryEvidence: true } : {}),
				sourcePath,
				sourceText,
			},
			typescriptSession,
			mapped,
		).diagnostics

		return {
			cssPath,
			diagnostics,
			index,
			status: `checked`,
			...(mapped ? { ownership: mapped.ownership } : {}),
			...assignment,
			tsxPath: sourcePath,
			workerId,
		}
	} catch (error) {
		return {
			cssPath,
			diagnostics: [],
			error: errorMessage(error),
			index,
			status: `failed`,
			...assignment,
			...(sourcePath ? { tsxPath: sourcePath } : {}),
			workerId,
		}
	}
}

function resolveFileSystem(
	fileSystem: Partial<LasertagCheckFileSystem> | undefined,
): LasertagCheckFileSystem {
	return {
		fileExists: fileSystem?.fileExists ?? defaultFileSystem.fileExists,
		readFile: fileSystem?.readFile ?? defaultFileSystem.readFile,
	}
}

function summarizeCheck(
	fileResults: LasertagCheckFileResult[],
	workerCount: number,
	stealCount: number,
): LasertagCheckResult {
	const orderedResults = [...fileResults].sort(
		(left, right) => left.index - right.index,
	)

	return {
		diagnostics: orderedResults.flatMap((result) => {
			const { tsxPath } = result

			return tsxPath
				? result.diagnostics.map((diagnostic) => ({
						cssPath: result.cssPath,
						diagnostic,
						tsxPath,
					}))
				: []
		}),
		failures: orderedResults.filter((result) => result.status === `failed`),
		fileResults: orderedResults,
		stealCount,
		workerCount,
	}
}

export async function processLasertagCheckTask(
	task: LasertagWorkTask,
	workerId: number,
	typescriptSession: TypescriptAstSession,
	mapper?: ReturnType<typeof createCliCssAnalysis>,
	fileSystem: LasertagCheckFileSystem = defaultFileSystem,
): Promise<LasertagCheckFileResult> {
	if (task.operation !== `check`) {
		throw new Error(`Cannot process ${task.operation} task as a check.`)
	}

	let prepared: PreparedCssAnalysis | undefined
	try {
		prepared = await mapper?.prepare(task.cssPath, fileSystem)
	} catch {
		/* File failures are reported by the ordinary path. */
	}
	const result = checkFile(
		task,
		workerId,
		fileSystem,
		typescriptSession,
		prepared,
	)
	return result
}

export async function runLasertagCheck(
	files: string[],
	options: RunLasertagCheckOptions = {},
): Promise<LasertagCheckResult> {
	const fileSystem = resolveFileSystem(options.fileSystem)
	const typescriptSession = createTypescriptAstSession(
		options.typescriptSdkPath
			? { typescriptSdkPath: options.typescriptSdkPath }
			: {},
	)
	const hasCustomFileSystem =
		options.fileSystem !== undefined &&
		Object.keys(options.fileSystem).length > 0

	const mapper = !hasCustomFileSystem
		? createCliCssAnalysis(
				options.workerModuleUrl ?? new URL(`./main.ts`, import.meta.url),
				typescriptSession,
				options.typescriptSdkPath,
			)
		: undefined
	try {
		const work = await runWorkStealing<LasertagCheckFileResult>({
			files,
			forceSerial: hasCustomFileSystem,
			...(options.includeStoryEvidence ? { includeStoryEvidence: true } : {}),
			operation: `check`,
			processSerial: (task, workerId) =>
				processLasertagCheckTask(
					task,
					workerId,
					typescriptSession,
					mapper,
					fileSystem,
				),
			...(options.typescriptSdkPath
				? { typescriptSdkPath: options.typescriptSdkPath }
				: {}),
			workerCount: options.workerCount ?? 1,
			...(options.workerModuleUrl
				? { workerModuleUrl: options.workerModuleUrl }
				: {}),
		})

		return summarizeCheck(work.fileResults, work.workerCount, work.stealCount)
	} finally {
		await mapper?.close()
		typescriptSession.close()
	}
}
