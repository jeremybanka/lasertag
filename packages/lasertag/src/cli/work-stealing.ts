import { availableParallelism } from "node:os"
import {
	parentPort,
	Worker,
	type MessagePort,
	type WorkerOptions,
} from "node:worker_threads"

const LASERTAG_WORKER_KIND = `lasertag-cli-worker`
const WORKER_STOP_GRACE_PERIOD_MS = 5_000

export type LasertagWorkerOperation = `check` | `fix`

export type LasertagWorkTask = {
	cssPath: string
	includeStoryEvidence?: boolean
	index: number
	operation: LasertagWorkerOperation
	stolenFrom?: number
}

export type LasertagWorkResult = {
	cssPath: string
	index: number
	workerId: number
	stolenFrom?: number
}

export type LasertagWorkerData = {
	kind: typeof LASERTAG_WORKER_KIND
	workerId: number
	typescriptSdkPath?: string
}

export type WorkStealingProgress<TResult extends LasertagWorkResult> = {
	completed: number
	file: TResult
	total: number
}

export type WorkStealingStart = {
	total: number
	workerCount: number
}

export type WorkStealingRunResult<TResult extends LasertagWorkResult> = {
	fileResults: TResult[]
	stealCount: number
	workerCount: number
}

export type RunWorkStealingOptions<TResult extends LasertagWorkResult> = {
	files: string[]
	forceSerial?: boolean
	includeStoryEvidence?: boolean
	onProgress?: (progress: WorkStealingProgress<TResult>) => void
	onStart?: (start: WorkStealingStart) => void
	operation: LasertagWorkerOperation
	processSerial: (task: LasertagWorkTask, workerId: number) => TResult
	typescriptSdkPath?: string
	workerCount?: number
	workerModuleUrl?: string | URL
}

type WorkerMessage =
	| { type: `ready` }
	| { result: LasertagWorkResult; type: `result` }

type CoordinatorMessage =
	| { task: LasertagWorkTask; type: `task` }
	| { type: `stop` }

type WorkDeque = {
	head: number
	items: LasertagWorkTask[]
	tail: number
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

function createWorkDeques(
	files: string[],
	workerCount: number,
	operation: LasertagWorkerOperation,
	includeStoryEvidence: boolean | undefined,
): WorkDeque[] {
	const tasks = files.map((cssPath, index) => ({
		cssPath,
		...(includeStoryEvidence ? { includeStoryEvidence: true } : {}),
		index,
		operation,
	}))
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

function takeOwnWork(deque: WorkDeque): LasertagWorkTask | undefined {
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
): LasertagWorkTask | undefined {
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

function workerOptions(data: LasertagWorkerData): WorkerOptions {
	return { workerData: data }
}

function orderedResults<TResult extends LasertagWorkResult>(
	fileResults: TResult[],
): TResult[] {
	return [...fileResults].sort((left, right) => left.index - right.index)
}

function runSerial<TResult extends LasertagWorkResult>(
	options: RunWorkStealingOptions<TResult>,
): WorkStealingRunResult<TResult> {
	const fileResults: TResult[] = []

	for (const [index, cssPath] of options.files.entries()) {
		const result = options.processSerial(
			{
				cssPath,
				...(options.includeStoryEvidence ? { includeStoryEvidence: true } : {}),
				index,
				operation: options.operation,
			},
			0,
		)

		fileResults.push(result)
		options.onProgress?.({
			completed: fileResults.length,
			file: result,
			total: options.files.length,
		})
	}

	return {
		fileResults,
		stealCount: 0,
		workerCount: options.files.length === 0 ? 0 : 1,
	}
}

async function runParallel<TResult extends LasertagWorkResult>(
	options: RunWorkStealingOptions<TResult>,
	workerCount: number,
): Promise<WorkStealingRunResult<TResult>> {
	const { workerModuleUrl } = options

	if (!workerModuleUrl) return runSerial(options)

	const deques = createWorkDeques(
		options.files,
		workerCount,
		options.operation,
		options.includeStoryEvidence,
	)
	const fileResults: TResult[] = []
	const workers: Worker[] = []
	const workerStopTimers = new Map<Worker, ReturnType<typeof setTimeout>>()
	let exitedWorkers = 0
	let failureError: unknown
	let settled = false
	let stealCount = 0
	let stopping = false

	return new Promise<WorkStealingRunResult<TResult>>((resolve, reject) => {
		const maybeReject = () => {
			if (!stopping || settled || exitedWorkers !== workers.length) {
				return
			}

			settled = true
			reject(failureError)
		}
		const stopWorkers = () => {
			for (const worker of workers) {
				if (worker.threadId === -1) continue

				// Let the worker's finally blocks close native parser processes. Keep
				// termination only as a bounded fallback for an unresponsive task.
				try {
					worker.postMessage({ type: `stop` } satisfies CoordinatorMessage)
				} catch {
					// An exiting worker may already have closed its message port. Its exit
					// handler still clears the fallback below.
				}

				const stopTimer = setTimeout(() => {
					void worker.terminate()
				}, WORKER_STOP_GRACE_PERIOD_MS)

				stopTimer.unref()
				workerStopTimers.set(worker, stopTimer)
			}
		}
		const fail = (error: unknown) => {
			if (settled || stopping) return

			failureError = error
			stopping = true
			stopWorkers()
			maybeReject()
		}
		const maybeResolve = () => {
			if (settled || stopping || exitedWorkers !== workerCount) return

			if (fileResults.length !== options.files.length) {
				fail(
					new Error(
						`Lasertag ${options.operation} workers completed ${fileResults.length} of ${options.files.length} files.`,
					),
				)
				return
			}

			settled = true
			resolve({
				fileResults: orderedResults(fileResults),
				stealCount,
				workerCount,
			})
		}
		const assignWork = (worker: Worker, workerId: number) => {
			const ownDeque = deques[workerId]

			if (!ownDeque) {
				fail(new Error(`Missing work deque for worker ${workerId}.`))
				return
			}

			const ownTask = takeOwnWork(ownDeque)
			const task = ownTask ?? stealWork(deques, workerId)

			if (!ownTask && task) stealCount += 1

			const message: CoordinatorMessage = task
				? { task, type: `task` }
				: { type: `stop` }

			worker.postMessage(message)
		}

		for (let workerId = 0; workerId < workerCount; workerId += 1) {
			const data: LasertagWorkerData = {
				kind: LASERTAG_WORKER_KIND,
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
				const stopTimer = workerStopTimers.get(worker)

				if (stopTimer) {
					clearTimeout(stopTimer)
					workerStopTimers.delete(worker)
				}

				exitedWorkers += 1

				if (stopping) {
					maybeReject()
					return
				}

				if (code !== 0) {
					fail(
						new Error(
							`Lasertag ${options.operation} worker exited with code ${code}.`,
						),
					)
					return
				}

				maybeResolve()
			})
			worker.on(`message`, (message: WorkerMessage) => {
				if (settled || stopping) return

				if (message.type === `ready`) {
					assignWork(worker, workerId)
					return
				}

				const result = message.result as TResult

				fileResults.push(result)

				try {
					options.onProgress?.({
						completed: fileResults.length,
						file: result,
						total: options.files.length,
					})
				} catch (error) {
					fail(error)
				}
			})
		}
	})
}

export function isLasertagWorkerData(
	value: unknown,
): value is LasertagWorkerData {
	if (!value || typeof value !== `object`) return false

	const candidate = value as Partial<LasertagWorkerData>

	return (
		candidate.kind === LASERTAG_WORKER_KIND &&
		typeof candidate.workerId === `number` &&
		Number.isInteger(candidate.workerId)
	)
}

export async function runLasertagWorker(
	data: LasertagWorkerData,
	processTask: (task: LasertagWorkTask, workerId: number) => LasertagWorkResult,
): Promise<void> {
	if (!parentPort) {
		throw new Error(`Lasertag worker requires a parent message port.`)
	}

	await runWorkerMessageLoop(parentPort, data, processTask)
}

function runWorkerMessageLoop(
	port: MessagePort,
	data: LasertagWorkerData,
	processTask: (task: LasertagWorkTask, workerId: number) => LasertagWorkResult,
): Promise<void> {
	return new Promise((resolve) => {
		port.on(`message`, (message: CoordinatorMessage) => {
			if (message.type === `stop`) {
				port.close()
				resolve()
				return
			}

			const result = processTask(message.task, data.workerId)
			const response: WorkerMessage = { result, type: `result` }

			port.postMessage(response)
			port.postMessage({ type: `ready` } satisfies WorkerMessage)
		})

		port.postMessage({ type: `ready` } satisfies WorkerMessage)
	})
}

export async function runWorkStealing<TResult extends LasertagWorkResult>(
	options: RunWorkStealingOptions<TResult>,
): Promise<WorkStealingRunResult<TResult>> {
	const workerCount = normalizeWorkerCount(
		options.files.length,
		options.workerCount,
	)
	const runsInParallel =
		workerCount > 1 &&
		!options.forceSerial &&
		options.workerModuleUrl !== undefined
	const effectiveWorkerCount = runsInParallel
		? workerCount
		: options.files.length === 0
			? 0
			: 1

	options.onStart?.({
		total: options.files.length,
		workerCount: effectiveWorkerCount,
	})

	if (!runsInParallel) return runSerial(options)

	return runParallel(options, workerCount)
}
