import * as ts from "typescript/unstable/ast"
import type { CompilerOptions } from "typescript/unstable/sync"

export type JsxRuntime = `react` | `solid` | `unknown`

/** Identify the JSX consumer, not libraries whose components or types are imported. */
export function resolveJsxRuntime(
	sourceFile: ts.SourceFile,
	compilerOptions: CompilerOptions = {},
): JsxRuntime {
	const pragmas = new Map<string, string>()
	for (const comment of ts.getLeadingCommentRanges(sourceFile.text, 0) ?? []) {
		if (comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
		const text = sourceFile.text.slice(comment.pos, comment.end)
		for (const match of text.matchAll(
			/@jsx(ImportSource|Runtime)?\s+([^\s*]+)/g,
		)) {
			pragmas.set(match[1] ?? `Factory`, match[2]!)
		}
	}

	const runtime = pragmas.get(`Runtime`)
	const factory = pragmas.get(`Factory`) ?? compilerOptions.jsxFactory
	// TypeScript's public unstable API exposes the numeric JsxEmit values:
	// React = 3, ReactJSX = 4, ReactJSXDev = 5.
	const classic =
		runtime === `classic` ||
		(runtime === undefined && compilerOptions.jsx === 3)
	if (classic || pragmas.has(`Factory`)) {
		if (factory && factory !== `React.createElement`) return `unknown`
		if (
			compilerOptions.reactNamespace &&
			compilerOptions.reactNamespace !== `React`
		)
			return `unknown`
		return `react`
	}
	if (runtime !== undefined && runtime !== `automatic`) return `unknown`
	const importSource =
		pragmas.get(`ImportSource`) ?? compilerOptions.jsxImportSource
	if (importSource !== undefined) {
		if (importSource === `react`) return `react`
		if (importSource === `solid-js`) return `solid`
		return `unknown`
	}
	if (
		runtime === `automatic` ||
		compilerOptions.jsx === 4 ||
		compilerOptions.jsx === 5
	) {
		return `react`
	}
	return `unknown`
}
