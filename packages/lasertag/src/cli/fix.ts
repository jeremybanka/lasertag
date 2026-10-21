import {
	createCliCssAnalysis,
	currentCssAnalysis,
	type PreparedCssAnalysis,
} from "./css-analysis.ts"
import { validateCssAnalysis } from "../refractor/css-analysis.ts"
import type { CssOwnershipResult } from "../refractor/css-ownership-evidence.ts"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import {
	createDeadSelectorCleanupRanges,
	createExpectErrorCleanupRanges,
	type OffsetRange,
} from "../lsp/code-actions.ts"
import {
	analyzeCssModuleSelectors,
	ambiguousRenderSourceMessage,
	createTypescriptAstSession,
	createCssReachabilityDiagnostics,
	resolveSiblingRenderSource,
	type CssReachabilityDiagnostic,
	type TypescriptAstSession,
	type ValidateCssReachabilityResult,
} from "../refractor/index.ts"
import {
	runWorkStealing,
	type LasertagWorkResult,
	type LasertagWorkTask,
	type WorkStealingProgress,
	type WorkStealingStart,
} from "./work-stealing.ts"

export type LasertagFixFileStatus =
	| `changed`
	| `failed`
	| `skipped`
	| `unchanged`

export type LasertagFixFileResult = LasertagWorkResult & {
	ownership?: CssOwnershipResult[`ownership`]
	diagnostics: CssReachabilityDiagnostic[]
	fixedCount: number
	remainingDiagnostics: CssReachabilityDiagnostic[]
	status: LasertagFixFileStatus
	error?: string
	tsxPath?: string
}

export type LasertagFixProgress = WorkStealingProgress<LasertagFixFileResult>

export type LasertagFixStart = WorkStealingStart

export type LasertagFixResult = {
	changedFiles: string[]
	failures: LasertagFixFileResult[]
	fileResults: LasertagFixFileResult[]
	fixedCount: number
	remainingDiagnostics: Array<{
		cssPath: string
		diagnostic: CssReachabilityDiagnostic
		tsxPath: string
	}>
	stealCount: number
	workerCount: number
}

export type LasertagFixFileSystem = {
	fileExists: (filePath: string) => boolean
	readFile: (filePath: string) => string
	writeFile: (filePath: string, sourceText: string) => void
}

export type RunLasertagFixOptions = {
	cssOwnership?: boolean
	fileSystem?: Partial<LasertagFixFileSystem>
	onProgress?: (progress: LasertagFixProgress) => void
	onStart?: (start: LasertagFixStart) => void
	typescriptSdkPath?: string
	workerCount?: number
	workerModuleUrl?: string | URL
}

const defaultFileSystem: LasertagFixFileSystem = {
	fileExists: existsSync,
	readFile: (filePath) => readFileSync(filePath, `utf-8`),
	writeFile: (filePath, sourceText) => writeFileSync(filePath, sourceText),
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function applyCleanupRanges(sourceText: string, ranges: OffsetRange[]): string {
	return [...ranges]
		.sort((left, right) => right.start - left.start || right.end - left.end)
		.reduce(
			(text, range) => `${text.slice(0, range.start)}${text.slice(range.end)}`,
			sourceText,
		)
}

function diagnosticRanges(
	diagnostics: CssReachabilityDiagnostic[],
	codes: CssReachabilityDiagnostic[`code`][],
): OffsetRange[] {
	return diagnostics.flatMap((diagnostic) =>
		diagnostic.range && codes.includes(diagnostic.code)
			? [diagnostic.range]
			: [],
	)
}

function validateSources(
	cssPath: string,
	cssSource: string,
	sourcePath: string,
	sourceText: string,
	typescriptSession: TypescriptAstSession,
	mapped?: CssOwnershipResult,
): ValidateCssReachabilityResult {
	return validateCssAnalysis(
		{
			cssPath,
			cssSource,
			sourcePath,
			sourceText,
		},
		typescriptSession,
		mapped,
	)
}

function fixFile(
	task: LasertagWorkTask,
	workerId: number,
	fileSystem: LasertagFixFileSystem,
	typescriptSession: TypescriptAstSession,
	prepared?: PreparedCssAnalysis,
): LasertagFixFileResult {
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
				fixedCount: 0,
				index,
				remainingDiagnostics: [],
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
		const validation = validateSources(
			cssPath,
			cssSource,
			sourcePath,
			sourceText,
			typescriptSession,
			mapped,
		)
		const { diagnostics } = validation
		const cleanupRanges = [
			...createDeadSelectorCleanupRanges(
				cssSource,
				diagnosticRanges(diagnostics, [
					`dead-selector`,
					`impossible-local-class`,
				]),
			),
			...createExpectErrorCleanupRanges(
				cssSource,
				diagnosticRanges(diagnostics, [`unused-expect-error`]),
			),
		]
		const fixedSource = applyCleanupRanges(cssSource, cleanupRanges)

		if (fixedSource === cssSource) {
			return {
				cssPath,
				diagnostics,
				fixedCount: 0,
				index,
				remainingDiagnostics: diagnostics,
				status: `unchanged`,
				...(mapped ? { ownership: mapped.ownership } : {}),
				...assignment,
				tsxPath: sourcePath,
				workerId,
			}
		}

		const remainingDiagnostics = createCssReachabilityDiagnostics({
			cssSource: fixedSource,
			renderStory: validation.renderStory,
			selectorAnalyses: analyzeCssModuleSelectors(fixedSource),
		})

		fileSystem.writeFile(cssPath, fixedSource)

		return {
			cssPath,
			diagnostics,
			fixedCount: Math.max(diagnostics.length - remainingDiagnostics.length, 0),
			index,
			remainingDiagnostics,
			status: `changed`,
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
			fixedCount: 0,
			index,
			remainingDiagnostics: [],
			status: `failed`,
			...assignment,
			...(sourcePath ? { tsxPath: sourcePath } : {}),
			workerId,
		}
	}
}

function resolveFileSystem(
	fileSystem: Partial<LasertagFixFileSystem> | undefined,
): LasertagFixFileSystem {
	return {
		fileExists: fileSystem?.fileExists ?? defaultFileSystem.fileExists,
		readFile: fileSystem?.readFile ?? defaultFileSystem.readFile,
		writeFile: fileSystem?.writeFile ?? defaultFileSystem.writeFile,
	}
}

function summarizeFix(
	fileResults: LasertagFixFileResult[],
	workerCount: number,
	stealCount: number,
): LasertagFixResult {
	const orderedResults = [...fileResults].sort(
		(left, right) => left.index - right.index,
	)

	return {
		changedFiles: orderedResults.flatMap((result) =>
			result.status === `changed` ? [result.cssPath] : [],
		),
		failures: orderedResults.filter((result) => result.status === `failed`),
		fileResults: orderedResults,
		fixedCount: orderedResults.reduce(
			(total, result) => total + result.fixedCount,
			0,
		),
		remainingDiagnostics: orderedResults.flatMap((result) => {
			const { tsxPath } = result

			return tsxPath
				? result.remainingDiagnostics.map((diagnostic) => ({
						cssPath: result.cssPath,
						diagnostic,
						tsxPath,
					}))
				: []
		}),
		stealCount,
		workerCount,
	}
}

export function processLasertagFixTask(
	task: LasertagWorkTask,
	workerId: number,
	typescriptSession: TypescriptAstSession,
): LasertagFixFileResult {
	if (task.operation !== `fix`) {
		throw new Error(`Cannot process ${task.operation} task as a fix.`)
	}

	return fixFile(task, workerId, defaultFileSystem, typescriptSession)
}

export async function runLasertagFix(
	files: string[],
	options: RunLasertagFixOptions = {},
): Promise<LasertagFixResult> {
	const fileSystem = resolveFileSystem(options.fileSystem)
	const typescriptSession = createTypescriptAstSession(
		options.typescriptSdkPath
			? { typescriptSdkPath: options.typescriptSdkPath }
			: {},
	)
	const hasCustomFileSystem =
		options.fileSystem !== undefined &&
		Object.keys(options.fileSystem).length > 0

	const mapper = options.cssOwnership
		? createCliCssAnalysis(
				options.workerModuleUrl ?? new URL(`./main.ts`, import.meta.url),
				typescriptSession,
				options.typescriptSdkPath,
			)
		: undefined
	try {
		const work = await runWorkStealing<LasertagFixFileResult>({
			files,
			forceSerial: hasCustomFileSystem || !!mapper,
			...(options.onProgress ? { onProgress: options.onProgress } : {}),
			...(options.onStart ? { onStart: options.onStart } : {}),
			operation: `fix`,
			processSerial: async (task, workerId) => {
				let prepared: PreparedCssAnalysis | undefined
				try {
					prepared = await mapper?.prepare(task.cssPath, fileSystem)
				} catch {
					/* File failures are reported by the ordinary path. */
				}
				const result = fixFile(
					task,
					workerId,
					fileSystem,
					typescriptSession,
					prepared,
				)
				if (mapper && result.status === `changed`) {
					try {
						result.ownership = (await mapper.prepare(task.cssPath, fileSystem))
							?.ownership ?? {
							status: `unavailable`,
							reason: `Ownership could not be refreshed after cleanup.`,
						}
					} catch {
						result.ownership = {
							status: `unavailable`,
							reason: `Ownership could not be refreshed after cleanup.`,
						}
					}
				}
				return result
			},
			...(options.typescriptSdkPath
				? { typescriptSdkPath: options.typescriptSdkPath }
				: {}),
			...(options.workerCount ? { workerCount: options.workerCount } : {}),
			...(options.workerModuleUrl
				? { workerModuleUrl: options.workerModuleUrl }
				: {}),
		})

		return summarizeFix(work.fileResults, work.workerCount, work.stealCount)
	} finally {
		await mapper?.close()
		typescriptSession.close()
	}
}
