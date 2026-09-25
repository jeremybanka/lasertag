import * as ts from "typescript/unstable/ast"
import type { CompilerOptions } from "typescript/unstable/sync"

import type { TypescriptAstAnalysis } from "./typescript-ast.ts"

export type JsxRuntime = `react` | `solid` | `unknown`

// Retain the selected factory so classic bindings can be checked at each JSX
// location. Automatic runtime imports are generated and cannot be shadowed.
export type JsxFactory =
	| { kind: `automatic`; importSource: string }
	| { kind: `classic`; name: string }
	| { kind: `unknown` }

/** Resolve declared JSX settings, without guessing from dependencies or types. */
export function resolveJsxFactory(
	sourceFile: ts.SourceFile,
	compilerOptions: CompilerOptions = {},
): JsxFactory {
	const pragmas = new Map<string, string>()
	for (const comment of ts.getLeadingCommentRanges(sourceFile.text, 0) ?? []) {
		if (comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
		const text = sourceFile.text.slice(comment.pos, comment.end)
		for (const match of text.matchAll(
			/@jsx(ImportSource|Runtime)?(?=\s|\*\/|$)\s*([^\s*]+)?/g,
		)) {
			const key = match[1] ?? `Factory`
			const value = match[2]
			if (!value) return { kind: `unknown` }
			if (pragmas.has(key) && pragmas.get(key) !== value)
				return { kind: `unknown` }
			pragmas.set(key, value)
		}
	}

	const runtime = pragmas.get(`Runtime`)
	if (
		runtime !== undefined &&
		runtime !== `automatic` &&
		runtime !== `classic`
	) {
		return { kind: `unknown` }
	}
	// TypeScript's public unstable API exposes numeric JsxEmit values:
	// React = 3, ReactJSX = 4, ReactJSXDev = 5.
	const automatic =
		runtime === `automatic` ||
		(runtime === undefined &&
			(compilerOptions.jsx === 4 || compilerOptions.jsx === 5))
	const classic =
		runtime === `classic` ||
		(runtime === undefined && compilerOptions.jsx === 3)
	const importSource =
		pragmas.get(`ImportSource`) ?? compilerOptions.jsxImportSource
	const factory = pragmas.get(`Factory`) ?? compilerOptions.jsxFactory

	if (automatic) {
		// A classic file pragma contradicts the selected automatic transform.
		if (pragmas.has(`Factory`)) return { kind: `unknown` }
		return { kind: `automatic`, importSource: importSource ?? `react` }
	}
	if (classic || factory !== undefined) {
		if (pragmas.has(`ImportSource`)) return { kind: `unknown` }
		return {
			kind: `classic`,
			name:
				factory ?? `${compilerOptions.reactNamespace ?? `React`}.createElement`,
		}
	}
	// Preserve-mode builds can still declare their consumer explicitly. We do
	// not inspect or execute Babel, Vite, or SWC configuration to infer one.
	return importSource !== undefined
		? { kind: `automatic`, importSource }
		: { kind: `unknown` }
}

export function resolveJsxRuntime(
	factory: JsxFactory,
	location: ts.Node,
	analysis: TypescriptAstAnalysis,
): JsxRuntime {
	if (factory.kind === `unknown`) return `unknown`
	if (factory.kind === `automatic`) {
		if (factory.importSource === `react`) return `react`
		if (factory.importSource === `solid-js`) return `solid`
		return `unknown`
	}

	// Deliberately support only a direct ESM import of createElement, or one
	// property access through React's default/namespace import. Local aliases,
	// CommonJS, re-exports, and unbound globals do not establish this contract.
	const [root, member, ...rest] = factory.name.split(`.`)
	if (
		!root ||
		rest.length > 0 ||
		(member !== undefined && member !== `createElement`)
	) {
		return `unknown`
	}
	const declarations = analysis.resolveValueDeclarations?.(root, location) ?? []
	if (declarations.length !== 1) return `unknown`
	const declaration = declarations[0]!
	let clause: ts.Node
	let importedName: string
	if (ts.isImportClause(declaration)) {
		clause = declaration
		importedName = `default`
	} else if (ts.isNamespaceImport(declaration)) {
		clause = declaration.parent
		importedName = `*`
	} else if (ts.isImportSpecifier(declaration)) {
		if (declaration.isTypeOnly) return `unknown`
		clause = declaration.parent.parent
		importedName = (declaration.propertyName ?? declaration.name).text
	} else {
		return `unknown`
	}
	if (
		!ts.isImportClause(clause) ||
		clause.phaseModifier === ts.SyntaxKind.TypeKeyword
	)
		return `unknown`
	const statement = clause.parent
	if (!ts.isImportDeclaration(statement)) return `unknown`
	const moduleSpecifier = statement.moduleSpecifier
	if (
		!ts.isStringLiteralLikeNode(moduleSpecifier) ||
		moduleSpecifier.text !== `react`
	) {
		return `unknown`
	}
	return (member === undefined && importedName === `createElement`) ||
		(member === `createElement` &&
			(importedName === `default` || importedName === `*`))
		? `react`
		: `unknown`
}
