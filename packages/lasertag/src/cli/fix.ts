import { existsSync, readFileSync, writeFileSync } from "node:fs"

import {
	createDeadSelectorCleanupRanges,
	createExpectErrorCleanupRanges,
	type OffsetRange,
} from "../lsp/code-actions.ts"
import {
	analyzeCssModuleSelectors,
	createTypescriptAstSession,
	createCssReachabilityDiagnostics,
	validateCssReachability,
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

function siblingTsxPath(cssPath: string): string {
	return `${cssPath.slice(0, -`.module.css`.length)}.tsx`
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
	tsxPath: string,
	tsxSource: string,
	typescriptSession: TypescriptAstSession,
): ValidateCssReachabilityResult {
	return validateCssReachability(
		{
			cssPath,
			cssSource,
			tsxPath,
			tsxSource,
		},
		typescriptSession,
	)
}

function fixFile(
	task: LasertagWorkTask,
	workerId: number,
	fileSystem: LasertagFixFileSystem,
	typescriptSession: TypescriptAstSession,
): LasertagFixFileResult {
	const { cssPath, index, stolenFrom } = task
	const tsxPath = siblingTsxPath(cssPath)
	const assignment = stolenFrom === undefined ? {} : { stolenFrom }

	try {
		if (!fileSystem.fileExists(tsxPath)) {
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

		const cssSource = fileSystem.readFile(cssPath)
		const tsxSource = fileSystem.readFile(tsxPath)
		const validation = validateSources(
			cssPath,
			cssSource,
			tsxPath,
			tsxSource,
			typescriptSession,
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
				...assignment,
				tsxPath,
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
			...assignment,
			tsxPath,
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
			tsxPath,
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

	try {
		const work = await runWorkStealing<LasertagFixFileResult>({
			files,
			forceSerial: hasCustomFileSystem,
			...(options.onProgress ? { onProgress: options.onProgress } : {}),
			...(options.onStart ? { onStart: options.onStart } : {}),
			operation: `fix`,
			processSerial: (task, workerId) =>
				fixFile(task, workerId, fileSystem, typescriptSession),
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
		typescriptSession.close()
	}
}
