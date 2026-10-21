import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export function createLspClient(root: string) {
	const entry =
		process.env.LASERTAG_TEST_LSP_ENTRY ??
		fileURLToPath(new URL(`../../../../src/lsp/server.ts`, import.meta.url))
	const processHandle = spawn(process.execPath, [entry, `--stdio`], {
		cwd: root,
		stdio: [`pipe`, `pipe`, `pipe`],
		env: {
			...process.env,
			PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ``}`,
		},
	})
	let sequence = 0
	let buffer = Buffer.alloc(0)
	let stderr = ``
	const pending = new Map<
		number,
		{
			resolve(value: unknown): void
			reject(error: Error): void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	function send(message: object) {
		const body = JSON.stringify({ jsonrpc: `2.0`, ...message })
		processHandle.stdin.write(
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
		)
	}
	processHandle.stderr.on(`data`, (chunk) => {
		stderr += String(chunk)
	})
	processHandle.stdout.on(`data`, (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk])
		while (true) {
			const separator = buffer.indexOf(`\r\n\r\n`)
			if (separator === -1) return
			const length = Number(
				/Content-Length: (\d+)/i.exec(
					buffer.subarray(0, separator).toString(),
				)?.[1],
			)
			if (buffer.length < separator + 4 + length) return
			const message = JSON.parse(
				buffer.subarray(separator + 4, separator + 4 + length).toString(),
			)
			buffer = buffer.subarray(separator + 4 + length)
			const request = pending.get(message.id)
			if (!request || message.method) {
				if (message.method === `window/logMessage`)
					stderr += `${message.params.message}\n`
				continue
			}
			pending.delete(message.id)
			clearTimeout(request.timer)
			if (message.error)
				request.reject(new Error(JSON.stringify(message.error)))
			else request.resolve(message.result)
		}
	})
	processHandle.on(`exit`, (code) => {
		for (const request of pending.values()) {
			clearTimeout(request.timer)
			request.reject(new Error(`LSP exited (${code}): ${stderr}`))
		}
		pending.clear()
	})
	function request<T = unknown>(
		method: string,
		params: unknown = null,
	): Promise<T> {
		const id = ++sequence
		const result = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`LSP ${method} timed out: ${stderr}`))
			}, 15_000)
			pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
			})
		})
		send({ id, method, params })
		return result
	}
	const notify = (method: string, params: unknown) => send({ method, params })
	return {
		request,
		notify,
		cancelLastRequest: () => notify(`$/cancelRequest`, { id: sequence }),
		async initialize(initializationOptions: unknown = {}, linkSupport = true) {
			const result = await request<{ capabilities: Record<string, unknown> }>(
				`initialize`,
				{
					processId: null,
					rootUri: pathToFileURL(root).href,
					capabilities: {
						textDocument: {
							definition: { linkSupport },
							declaration: { linkSupport },
						},
					},
					initializationOptions,
				},
			)
			notify(`initialized`, {})
			return result
		},
		open(filePath: string, text: string, languageId = `astro`, version = 1) {
			notify(`textDocument/didOpen`, {
				textDocument: {
					uri: pathToFileURL(filePath).href,
					languageId,
					version,
					text,
				},
			})
		},
		change(filePath: string, text: string, version = 2) {
			notify(`textDocument/didChange`, {
				textDocument: { uri: pathToFileURL(filePath).href, version },
				contentChanges: [{ text }],
			})
		},
		close(filePath: string) {
			notify(`textDocument/didClose`, {
				textDocument: { uri: pathToFileURL(filePath).href },
			})
		},
		async [Symbol.asyncDispose]() {
			if (processHandle.exitCode !== null) return
			const timer = setTimeout(() => processHandle.kill(`SIGKILL`), 3_000)
			try {
				await request(`shutdown`)
				notify(`exit`, null)
				await new Promise<void>((resolve) =>
					processHandle.once(`exit`, () => resolve()),
				)
			} finally {
				clearTimeout(timer)
			}
		},
	}
}
