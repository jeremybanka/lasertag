import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fork, spawn, type ChildProcess } from "node:child_process"

import type {
	CancellationToken,
	Location,
	LocationLink,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	analyzeAstroSemanticEvidence,
	astroComponentAtOffset,
} from "../refractor/astro-semantic-evidence.ts"
import { createTypescriptAstSession } from "../refractor/typescript-ast.ts"

export const ASTRO_NAVIGATION_WORKER = `lasertag-astro-navigation`

export function astroNavigationEnabled(
	initializationOptions: unknown,
): boolean {
	if (
		!initializationOptions ||
		typeof initializationOptions !== `object` ||
		!(`astroNavigation` in initializationOptions)
	)
		return false
	const options = initializationOptions.astroNavigation
	return (
		typeof options === `object` &&
		options !== null &&
		`enabled` in options &&
		options.enabled === true &&
		`runExternalCode` in options &&
		options.runExternalCode === true
	)
}

export type AstroNavigationTask = {
	filePath: string
	sourceText: string
	offset: number
	openFiles: Array<[string, string]>
	diskRevision: number
}

export type AstroNavigationTarget = {
	kind: `source` | `ambient`
	link: LocationLink
}

export function navigationLocations(
	targets: AstroNavigationTarget[],
	kind: AstroNavigationTarget[`kind`],
	linkSupport: boolean,
): LocationLink[] | Location[] {
	const links = targets
		.filter((target) => target.kind === kind)
		.map((target) => target.link)
	return linkSupport
		? links
		: links.map((link) => ({
				uri: link.targetUri,
				range: link.targetSelectionRange,
			}))
}

/** One session per worker. The entire current overlay set is supplied per request. */
export function createAstroNavigationAnalyzer() {
	const session = createTypescriptAstSession({ runExternalCode: true })
	let diskRevision: number | undefined
	return {
		close: () => session.close(),
		analyze(task: AstroNavigationTask): AstroNavigationTarget[] {
			const reference = astroComponentAtOffset(task.sourceText, task.offset)
			if (!reference) return []
			const openFiles = new Map(task.openFiles)
			openFiles.set(task.filePath, task.sourceText)
			const invalidate =
				diskRevision !== undefined && diskRevision !== task.diskRevision
			diskRevision = task.diskRevision
			const result = analyzeAstroSemanticEvidence(
				{
					filePath: task.filePath,
					sourceText: task.sourceText,
					typescriptSource: { openFiles, invalidate },
				},
				session,
			)
			if (result.semantics.status !== `available`) return []
			const component = result.semantics.components.find(
				({ range }) => range.start === reference.range.start,
			)
			if (component?.status !== `resolved`) return []
			const source = TextDocument.create(
				pathToFileURL(task.filePath).href,
				`astro`,
				0,
				task.sourceText,
			)
			// For closing tags, highlight the authored name at the request position.
			const openingStart = task.sourceText.lastIndexOf(`<`, task.offset)
			const start =
				task.sourceText[openingStart + 1] === `/`
					? openingStart + 2
					: reference.range.start
			const originSelectionRange = {
				start: source.positionAt(start),
				end: source.positionAt(start + reference.name.length),
			}
			const targets: AstroNavigationTarget[] = []
			for (const declaration of component.declarations) {
				try {
					const text =
						openFiles.get(declaration.sourcePath) ??
						readFileSync(declaration.sourcePath, `utf8`)
					const uri = pathToFileURL(declaration.sourcePath).href
					const target = TextDocument.create(uri, ``, 0, text)
					const range = declaration.range ?? { start: 0, end: 0 }
					if (
						range.start < 0 ||
						range.end < range.start ||
						range.end > text.length
					)
						continue
					const targetRange = {
						start: target.positionAt(range.start),
						end: target.positionAt(range.end),
					}
					targets.push({
						kind: declaration.kind,
						link: {
							originSelectionRange,
							targetUri: uri,
							targetRange,
							targetSelectionRange: targetRange,
						},
					})
				} catch {
					// A target deleted during a request is unavailable, not a guessed link.
				}
			}
			return targets.filter(
				(target, index) =>
					targets.findIndex(
						(candidate) => JSON.stringify(candidate) === JSON.stringify(target),
					) === index,
			)
		},
	}
}

type WorkerRequest = { id: number; task: AstroNavigationTask } | { close: true }
type WorkerResponse = { id: number; targets: AstroNavigationTarget[] }

export function runAstroNavigationWorker(): void {
	const analyzer = createAstroNavigationAnalyzer()
	process.on(`message`, (request: WorkerRequest) => {
		if (`close` in request) {
			analyzer.close()
			process.disconnect?.()
			return
		}
		let targets: AstroNavigationTarget[] = []
		try {
			targets = analyzer.analyze(request.task)
		} catch {
			/* Fail closed; CSS analysis uses another path. */
		}
		process.send?.({ id: request.id, targets } satisfies WorkerResponse)
	})
}

function stopNavigationProcess(child: ChildProcess): void {
	if (!child.pid) return
	if (process.platform === `win32`) {
		// Windows does not have POSIX process groups; terminate the owned tree.
		// cspell:ignore taskkill
		const killer = spawn(`taskkill`, [`/pid`, String(child.pid), `/T`, `/F`], {
			stdio: `ignore`,
			windowsHide: true,
		})
		killer.on(`error`, () => child.kill())
	} else {
		try {
			process.kill(-child.pid, `SIGKILL`)
		} catch {
			/* Already exited. */
		}
	}
}

/** Lazy, serialized worker keeps native synchronous calls off the LSP event loop. */
export function createAstroNavigationService(
	workerModule: string | URL,
	timeoutMs = 10_000,
) {
	let worker: ChildProcess | undefined
	let nextId = 0
	const pending = new Map<
		number,
		{
			finish: (targets: AstroNavigationTarget[]) => void
			timer: ReturnType<typeof setTimeout>
			cancel: { dispose(): void }
		}
	>()
	function reset(): Promise<void> {
		for (const request of pending.values()) {
			clearTimeout(request.timer)
			request.cancel.dispose()
			request.finish([])
		}
		pending.clear()
		const previous = worker
		worker = undefined
		if (!previous) return Promise.resolve()
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				stopNavigationProcess(previous)
			}, 1_000)
			timer.unref()
			// `close` also fires after a spawn error, which has no `exit` event.
			previous.once(`close`, () => {
				clearTimeout(timer)
				resolve()
			})
			if (previous.connected)
				previous.send({ close: true } satisfies WorkerRequest, () => {})
			else stopNavigationProcess(previous)
		})
	}
	function getWorker(): ChildProcess {
		if (worker) return worker
		const created = fork(
			workerModule instanceof URL ? fileURLToPath(workerModule) : workerModule,
			[`--${ASTRO_NAVIGATION_WORKER}`],
			{
				execArgv: [],
				detached: process.platform !== `win32`,
				stdio: [`ignore`, `ignore`, `pipe`, `ipc`],
				windowsHide: true,
			},
		)
		worker = created
		// The native API blocks in readSync; a process group is needed to stop
		// both it and its mapper even when the JS worker cannot handle messages.
		const stop = () => stopNavigationProcess(created)
		process.once(`exit`, stop)
		// Descendants can inherit stderr and keep `close` pending after an exit.
		created.once(`exit`, stop)
		created.stderr?.resume()
		created.on(`message`, ({ id, targets }: WorkerResponse) => {
			if (worker !== created) return
			const request = pending.get(id)
			if (!request) return
			pending.delete(id)
			clearTimeout(request.timer)
			request.cancel.dispose()
			request.finish(targets)
		})
		created.on(`error`, () => {
			if (worker === created) void reset()
		})
		created.on(`close`, () => {
			process.off(`exit`, stop)
			if (worker !== created) return
			worker = undefined
			void reset()
		})
		return created
	}
	return {
		reset,
		request(
			task: AstroNavigationTask,
			token: CancellationToken,
		): Promise<AstroNavigationTarget[]> {
			if (token.isCancellationRequested || pending.size >= 16)
				return Promise.resolve([])
			return new Promise((resolve) => {
				const id = ++nextId
				const timer = setTimeout(() => {
					void reset()
				}, timeoutMs)
				const cancel = token.onCancellationRequested(() => resolve([]))
				pending.set(id, { finish: resolve, timer, cancel })
				try {
					const active = getWorker()
					active.send({ id, task } satisfies WorkerRequest, (error) => {
						if (error && worker === active) void reset()
					})
				} catch {
					void reset()
				}
			})
		},
	}
}
