import { fork, spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { CancellationToken } from "vscode-languageserver/node"

function stopMapperProcess(child: ChildProcess): void {
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
export function createMapperProcess<TTask, TResult>(
	workerModule: string | URL,
	workerFlag: string,
	timeoutMs = 10_000,
) {
	let worker: ChildProcess | undefined
	let nextId = 0
	const pending = new Map<
		number,
		{
			finish: (result: TResult | undefined) => void
			timer: ReturnType<typeof setTimeout>
			cancel: { dispose(): void }
		}
	>()
	function reset(): Promise<void> {
		for (const request of pending.values()) {
			clearTimeout(request.timer)
			request.cancel.dispose()
			request.finish(undefined)
		}
		pending.clear()
		const previous = worker
		worker = undefined
		if (!previous) return Promise.resolve()
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				stopMapperProcess(previous)
			}, 1_000)
			timer.unref()
			// `close` also fires after a spawn error, which has no `exit` event.
			previous.once(`close`, () => {
				clearTimeout(timer)
				resolve()
			})
			if (previous.connected) previous.send({ close: true }, () => {})
			else stopMapperProcess(previous)
		})
	}
	function getWorker(): ChildProcess {
		if (worker) return worker
		const created = fork(
			workerModule instanceof URL ? fileURLToPath(workerModule) : workerModule,
			[`--${workerFlag}`],
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
		const stop = () => stopMapperProcess(created)
		process.once(`exit`, stop)
		// Descendants can inherit stderr and keep `close` pending after an exit.
		created.once(`exit`, stop)
		created.stderr?.resume()
		created.on(
			`message`,
			({ id, result }: { id: number; result?: TResult }) => {
				if (worker !== created) return
				const request = pending.get(id)
				if (!request) return
				pending.delete(id)
				clearTimeout(request.timer)
				request.cancel.dispose()
				request.finish(result)
			},
		)
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
			task: TTask,
			token?: CancellationToken,
		): Promise<TResult | undefined> {
			if (token?.isCancellationRequested || pending.size >= 16)
				return Promise.resolve(undefined)
			return new Promise((resolve) => {
				const id = ++nextId
				const timer = setTimeout(() => {
					void reset()
				}, timeoutMs)
				const cancel = token?.onCancellationRequested(() =>
					resolve(undefined),
				) ?? { dispose() {} }
				pending.set(id, { finish: resolve, timer, cancel })
				try {
					const active = getWorker()
					active.send({ id, task }, (error) => {
						if (error && worker === active) void reset()
					})
				} catch {
					void reset()
				}
			})
		},
	}
}
