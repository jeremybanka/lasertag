import { parse } from "@astrojs/compiler/sync"
import type { Node as AstroNode } from "@astrojs/compiler/types"

// A real process speaking the content-mapper protocol. Its deliberately lossy
// output checks component references and invents DOM; it is not a render transform.
type Options = { mode?: string }
const projects = new Map<string, Options>()

function transform(content: string, options: Options) {
	if (options.mode === `crash`) process.exit(1)
	if (options.mode === `empty`) return { text: ``, extension: `.tsx` }
	let text = `// Generated type-checking scaffold\n`
	const mappings: number[][] = []
	const bytes = Buffer.from(content)
	const utf16 = (offset: number) => bytes.subarray(0, offset).toString().length
	function append(
		value: string,
		originalStart: number,
		originalLength = value.length,
		kind = 0,
	) {
		mappings.push([
			text.length,
			value.length,
			originalStart,
			originalLength,
			kind,
		])
		text += value
	}
	const root = parse(content, { position: true }).ast
	for (const node of root.children) {
		if (node.type === `frontmatter`) {
			append(node.value, utf16(node.position!.start.offset) + 3)
		}
	}
	function visit(node: AstroNode) {
		if (node.type === `component`) {
			const start = utf16(node.position!.start.offset) + 1
			text += `\nvoid `
			if (options.mode === `atom`) {
				append(`ActualCard`, start, node.name.length, 1)
			} else {
				append(node.name, start)
			}
			text += `;\n`
			if (options.mode === `duplicate` || options.mode === `ambiguous`) {
				text += `void `
				append(
					options.mode === `ambiguous` ? `OtherCard` : node.name,
					start,
					node.name.length,
					options.mode === `ambiguous` ? 1 : 0,
				)
				text += `;\n`
			}
		}
		if (`children` in node) node.children.forEach(visit)
	}
	visit(root)
	text += `export default function __Template() { return <invented-wrapper><invented-child /></invented-wrapper> }`
	return {
		text,
		extension: `.tsx`,
		mappings: options.mode === `unmapped` ? mappings.slice(0, 1) : mappings,
		...(options.mode === `diagnostic`
			? {
					diagnostics: [
						{
							messageText: `Template could not be mapped`,
							start: 0,
							length: 1,
							code: 1,
						},
					],
				}
			: {}),
		supplemental: [
			{ text: `export const scriptOnly = <script-only />`, extension: `.tsx` },
		],
	}
}

type Request = {
	id: number
	method: string
	params: { projectHandle: string; options?: Options; content: string }
}
function handle(request: Request) {
	switch (request.method) {
		case `initialize`:
			return {
				positionEncoding: `utf-16`,
				diagnosticSource: `lasertag-test-astro`,
			}
		case `openProject`:
			projects.set(request.params.projectHandle, request.params.options ?? {})
			return {}
		case `closeProject`:
			projects.delete(request.params.projectHandle)
			return {}
		case `transform`:
			return transform(
				request.params.content,
				projects.get(request.params.projectHandle) ?? {},
			)
		default:
			throw new Error(`Unexpected method ${request.method}`)
	}
}

let pending = Buffer.alloc(0)
process.stdin.on(`data`, (chunk: Buffer) => {
	pending = Buffer.concat([pending, chunk])
	for (;;) {
		const headerEnd = pending.indexOf(`\r\n\r\n`)
		if (headerEnd < 0) return
		const length = Number(
			/Content-Length: (\d+)/i.exec(
				pending.subarray(0, headerEnd).toString(),
			)?.[1],
		)
		if (!Number.isFinite(length)) throw new Error(`Invalid RPC frame`)
		const bodyStart = headerEnd + 4
		if (pending.length < bodyStart + length) return
		const request = JSON.parse(
			pending.subarray(bodyStart, bodyStart + length).toString(),
		) as Request
		pending = pending.subarray(bodyStart + length)
		const result = handle(request)
		const response = JSON.stringify({ jsonrpc: `2.0`, id: request.id, result })
		process.stdout.write(
			`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`,
		)
	}
})
