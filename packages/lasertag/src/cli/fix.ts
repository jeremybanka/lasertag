import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import {
	parentPort,
	Worker,
	type MessagePort,
	type WorkerOptions,
} from "node:worker_threads"

import {
	createDeadSelectorCleanupRanges,
	type OffsetRange,
} from "../lsp/code-actions.ts"
import {
	analyzeCssModuleSelectors,
	createCssReachabilityDiagnostics,
	validateCssReachability,
	type CssReachabilityDiagnostic,
	type ValidateCssReachabilityResult,
} from "../refractor/index.ts"

const FIX_WORKER_KIND = `lasertag-fix-worker`

export type LasertagFixFileStatus =
	| `changed`
	| `failed`
	| `skipped`
	| `unchanged`

export type LasertagFixFileResult = {
	cssPath: string
	diagnostics: CssReachabilityDiagnostic[]
	fixedCount: number
	index: number
	remainingDiagnostics: CssReachabilityDiagnostic[]
	status: LasertagFixFileStatus
	workerId: number
	error?: string
	stolenFrom?: number
	tsxPath?: string
}

export type LasertagFixProgress = {
	completed: number
	file: LasertagFixFileResult
	total: number
}

export type LasertagFixStart = {
	total: number
	workerCount: number
}

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

export type LasertagFixWorkerData = {
	kind: typeof FIX_WORKER_KIND
	workerId: number
	typescriptSdkPath?: string
}

type LasertagFixTask = {
	cssPath: string
	index: number
	stolenFrom?: number
}

type LasertagFixWorkerMessage =
	| { type: `ready` }
	| { result: LasertagFixFileResult; type: `result` }

type LasertagFixCoordinatorMessage =
	| { task: LasertagFixTask; type: `task` }
	| { type: `stop` }

type WorkDeque = {
	head: number
	items: LasertagFixTask[]
	tail: number
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
): OffsetRange[] {
	return diagnostics.flatMap((diagnostic) =>
		diagnostic.range ? [diagnostic.range] : [],
	)
}

function validateSources(
	cssPath: string,
	cssSource: string,
	tsxPath: string,
	tsxSource: string,
	typescriptSdkPath: string | undefined,
): ValidateCssReachabilityResult {
	return validateCssReachability({
		cssPath,
		cssSource,
		...(typescriptSdkPath ? { typescriptSdkPath } : {}),
		tsxPath,
		tsxSource,
	})
}

function fixFile(
	task: LasertagFixTask,
	workerId: number,
	fileSystem: LasertagFixFileSystem,
	typescriptSdkPath: string | undefined,
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
			typescriptSdkPath,
		)
		const { diagnostics } = validation
		const cleanupRanges = createDeadSelectorCleanupRanges(
			cssSource,
			diagnosticRanges(diagnostics),
		)
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

function normalizeWorkerCount(
	fileCount: number,
	requestedWorkerCount: number | undefined,
): number {
	if (fileCount === 0) return 0

	const defaultWorkerCount = Math.max(availableParallelism() - 1, 1)
	const requested = requestedWorkerCount ?? defaultWorkerCount
	const finiteRequested = Number.isFinite(requested)
		? Math.floor(requested)
		: defaultWorkerCount

	return Math.min(fileCount, Math.max(finiteRequested, 1))
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

function runSerialFix(
	files: string[],
	options: RunLasertagFixOptions,
): LasertagFixResult {
	const fileSystem = resolveFileSystem(options.fileSystem)
	const fileResults: LasertagFixFileResult[] = []

	for (const [index, cssPath] of files.entries()) {
		const result = fixFile(
			{ cssPath, index },
			0,
			fileSystem,
			options.typescriptSdkPath,
		)

		fileResults.push(result)
		options.onProgress?.({
			completed: fileResults.length,
			file: result,
			total: files.length,
		})
	}

	return summarizeFix(fileResults, files.length === 0 ? 0 : 1, 0)
}

function createWorkDeques(files: string[], workerCount: number): WorkDeque[] {
	const tasks = files.map((cssPath, index) => ({ cssPath, index }))
	const baseSize = Math.floor(tasks.length / workerCount)
	let remainder = tasks.length % workerCount
	let start = 0

	return Array.from({ length: workerCount }, () => {
		const size = baseSize + (remainder > 0 ? 1 : 0)
		const items = tasks.slice(start, start + size)

		start += size
		remainder = Math.max(remainder - 1, 0)

		return { head: 0, items, tail: items.length }
	})
}

function dequeSize(deque: WorkDeque): number {
	return deque.tail - deque.head
}

function takeOwnWork(deque: WorkDeque): LasertagFixTask | undefined {
	if (deque.head >= deque.tail) return

	deque.tail -= 1
	return deque.items[deque.tail]
}

// Workers drain one end of their own deque. An idle worker takes from the
// opposite end of the fullest peer deque, keeping both operations O(1) while
// balancing files whose TypeScript render stories have very different costs.
function stealWork(
	deques: WorkDeque[],
	workerId: number,
): LasertagFixTask | undefined {
	let victimId = -1
	let victimSize = 0

	for (const [candidateId, deque] of deques.entries()) {
		if (candidateId === workerId) continue

		const size = dequeSize(deque)

		if (size > victimSize) {
			victimId = candidateId
			victimSize = size
		}
	}

	if (victimId === -1) return

	const victim = deques[victimId]

	if (!victim || victim.head >= victim.tail) return

	const task = victim.items[victim.head]

	victim.head += 1
	return task ? { ...task, stolenFrom: victimId } : undefined
}

function workerOptions(data: LasertagFixWorkerData): WorkerOptions {
	return { workerData: data }
}

async function runParallelFix(
	files: string[],
	workerCount: number,
	options: RunLasertagFixOptions,
): Promise<LasertagFixResult> {
	const workerModuleUrl = options.workerModuleUrl

	if (!workerModuleUrl) return runSerialFix(files, options)

	const deques = createWorkDeques(files, workerCount)
	const fileResults: LasertagFixFileResult[] = []
	const workers: Worker[] = []
	let exitedWorkers = 0
	let settled = false
	let stealCount = 0

	return new Promise<LasertagFixResult>((resolve, reject) => {
		const stopWorkers = () => {
			for (const worker of workers) void worker.terminate()
		}
		const fail = (error: unknown) => {
			if (settled) return

			settled = true
			stopWorkers()
			reject(error)
		}
		const maybeResolve = () => {
			if (settled || exitedWorkers !== workerCount) return

			if (fileResults.length !== files.length) {
				fail(
					new Error(
						`Lasertag fix workers completed ${fileResults.length} of ${files.length} files.`,
					),
				)
				return
			}

			settled = true
			resolve(summarizeFix(fileResults, workerCount, stealCount))
		}
		const assignWork = (worker: Worker, workerId: number) => {
			const ownTask = takeOwnWork(deques[workerId] as WorkDeque)
			const task = ownTask ?? stealWork(deques, workerId)

			if (!ownTask && task) stealCount += 1

			const message: LasertagFixCoordinatorMessage = task
				? { task, type: `task` }
				: { type: `stop` }

			worker.postMessage(message)
		}

		for (let workerId = 0; workerId < workerCount; workerId += 1) {
			const data: LasertagFixWorkerData = {
				kind: FIX_WORKER_KIND,
				...(options.typescriptSdkPath
					? { typescriptSdkPath: options.typescriptSdkPath }
					: {}),
				workerId,
			}
			let worker: Worker

			try {
				worker = new Worker(workerModuleUrl, workerOptions(data))
			} catch (error) {
				fail(error)
				break
			}

			workers.push(worker)
			worker.on(`error`, fail)
			worker.on(`exit`, (code) => {
				if (code !== 0) {
					fail(new Error(`Lasertag fix worker exited with code ${code}.`))
					return
				}

				exitedWorkers += 1
				maybeResolve()
			})
			worker.on(`message`, (message: LasertagFixWorkerMessage) => {
				if (settled) return

				if (message.type === `ready`) {
					assignWork(worker, workerId)
					return
				}

				fileResults.push(message.result)

				try {
					options.onProgress?.({
						completed: fileResults.length,
						file: message.result,
						total: files.length,
					})
				} catch (error) {
					fail(error)
				}
			})
		}
	})
}

export function isLasertagFixWorkerData(
	value: unknown,
): value is LasertagFixWorkerData {
	if (!value || typeof value !== `object`) return false

	const candidate = value as Partial<LasertagFixWorkerData>

	return (
		candidate.kind === FIX_WORKER_KIND &&
		typeof candidate.workerId === `number` &&
		Number.isInteger(candidate.workerId)
	)
}

function runWorkerMessageLoop(
	port: MessagePort,
	data: LasertagFixWorkerData,
): Promise<void> {
	return new Promise((resolve) => {
		port.on(`message`, (message: LasertagFixCoordinatorMessage) => {
			if (message.type === `stop`) {
				port.close()
				resolve()
				return
			}

			const result = fixFile(
				message.task,
				data.workerId,
				defaultFileSystem,
				data.typescriptSdkPath,
			)
			const response: LasertagFixWorkerMessage = { result, type: `result` }

			port.postMessage(response)
			port.postMessage({ type: `ready` } satisfies LasertagFixWorkerMessage)
		})

		port.postMessage({ type: `ready` } satisfies LasertagFixWorkerMessage)
	})
}

export async function runLasertagFixWorker(
	data: LasertagFixWorkerData,
): Promise<void> {
	if (!parentPort) {
		throw new Error(`Lasertag fix worker requires a parent message port.`)
	}

	await runWorkerMessageLoop(parentPort, data)
}

export async function runLasertagFix(
	files: string[],
	options: RunLasertagFixOptions = {},
): Promise<LasertagFixResult> {
	const workerCount = normalizeWorkerCount(files.length, options.workerCount)
	const hasCustomFileSystem =
		options.fileSystem !== undefined &&
		Object.keys(options.fileSystem).length > 0
	const runsInParallel =
		workerCount > 1 &&
		!hasCustomFileSystem &&
		options.workerModuleUrl !== undefined
	const effectiveWorkerCount = runsInParallel
		? workerCount
		: files.length === 0
			? 0
			: 1

	options.onStart?.({
		total: files.length,
		workerCount: effectiveWorkerCount,
	})

	if (!runsInParallel) {
		return runSerialFix(files, options)
	}

	return runParallelFix(files, workerCount, options)
}
