// Deliberately defective CSS projections exercise rejection, not CSS parsing.
const projects = new Map<string, string>()
type Request = {
	id: number
	method: string
	params: { projectHandle: string; options?: { mode: string }; content: string }
}
function handle({ method, params }: Request) {
	if (method === `initialize`)
		return { positionEncoding: `utf-16`, diagnosticSource: `lasertag-test-css` }
	if (method === `openProject`) {
		projects.set(params.projectHandle, params.options!.mode)
		return {}
	}
	if (method === `closeProject`) {
		projects.delete(params.projectHandle)
		return {}
	}
	if (method !== `transform`) throw new Error(`Unexpected method ${method}`)
	const mode = projects.get(params.projectHandle)
	if (mode === `crash`) process.exit(1)
	const text = `declare const styles: { readonly class: string }; export = styles`
	return {
		text,
		extension: `.cts`,
		mappings:
			mode === `unmapped`
				? []
				: [
						[
							text.indexOf(`class`),
							5,
							mode === `wrong-range` ? 0 : params.content.indexOf(`.class`) + 1,
							5,
							2,
							mode === `no-definition` ? 0 : 8,
						],
					],
	}
}
let buffer = Buffer.alloc(0)
process.stdin.on(`data`, (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk])
	while (true) {
		const end = buffer.indexOf(`\r\n\r\n`)
		if (end < 0) return
		const length = Number(
			/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
		)
		if (!Number.isFinite(length)) throw new Error(`Invalid RPC frame`)
		if (buffer.length < end + 4 + length) return
		const request = JSON.parse(
			buffer.subarray(end + 4, end + 4 + length).toString(),
		) as Request
		buffer = buffer.subarray(end + 4 + length)
		const response = JSON.stringify({
			jsonrpc: `2.0`,
			id: request.id,
			result: handle(request),
		})
		process.stdout.write(
			`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`,
		)
	}
})
