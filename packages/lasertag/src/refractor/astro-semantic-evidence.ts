import { parse } from "@astrojs/compiler/sync"
import type { Node as AstroNode } from "@astrojs/compiler/types"
import * as ts from "typescript/ast"

import {
	analyzeAstroRenderStory,
	type AnalyzeAstroOptions,
} from "./analyze-astro.ts"
import type { RenderStory, SourceRange } from "./diagnostics.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstAnalysis,
	type TypescriptAstSession,
	type TypescriptAstSourceOptions,
} from "./typescript-ast.ts"
import type { TypescriptRuntimeOptions } from "./typescript-runtime.ts"

type ComponentReference = { name: string; range: SourceRange }
type DeclarationEvidence = {
	sourcePath: string
	range?: SourceRange
	kind: `source` | `ambient`
}

export type AstroComponentEvidence = ComponentReference & {
	status: `resolved` | `unresolved` | `unmapped` | `ambiguous`
	declarations: DeclarationEvidence[]
}

export type AstroSemanticResult = {
	renderStory: RenderStory
	semantics:
		| { status: `available`; components: AstroComponentEvidence[] }
		| { status: `unavailable`; reason: string }
}

function componentReferences(
	sourceText: string,
	offsetAt?: number,
): ComponentReference[] {
	const references: ComponentReference[] = []
	const bytes = Buffer.from(sourceText)
	function visit(node: AstroNode) {
		if (node.type === `component` && node.position) {
			// Astro positions are UTF-8 byte offsets; TypeScript's JS span-map API
			// always uses UTF-16, including when a mapper negotiates UTF-8 over RPC.
			const offset = bytes
				.subarray(0, node.position.start.offset)
				.toString().length
			// A standalone self-closing root can start at its name instead of '<'.
			// Verify the authored anchor before accepting either parser position.
			const start = sourceText[offset] === `<` ? offset + 1 : offset
			if (
				sourceText[start - 1] === `<` &&
				sourceText.slice(start, start + node.name.length) === node.name
			) {
				const reference = {
					name: node.name,
					range: { start, end: start + node.name.length },
				}
				if (
					offsetAt === undefined ||
					(start <= offsetAt && offsetAt <= reference.range.end)
				)
					references.push(reference)
				else if (node.position.end) {
					const end = bytes
						.subarray(0, node.position.end.offset)
						.toString().length
					const closing = sourceText.lastIndexOf(`</${node.name}`, end)
					if (
						closing >= start &&
						/^\s*>$/.test(
							sourceText.slice(closing + node.name.length + 2, end),
						) &&
						closing + 2 <= offsetAt &&
						offsetAt <= closing + 2 + node.name.length
					)
						references.push(reference)
				}
			}
		}
		if (`children` in node) node.children.forEach(visit)
	}
	visit(parse(sourceText, { position: true }).ast)
	return references
}

/** Locate an opening or closing component name without starting TypeScript. */
export function astroComponentAtOffset(
	sourceText: string,
	offset: number,
): ComponentReference | undefined {
	return componentReferences(sourceText, offset)[0]
}

function declarationKind(node: ts.Node): DeclarationEvidence[`kind`] {
	if (node.getSourceFile().isDeclarationFile) return `ambient`
	for (
		let current: ts.Node | undefined = node;
		current;
		current = current.parent
	) {
		if (current.flags & ts.NodeFlags.Ambient) return `ambient`
	}
	return `source`
}

function declarationEvidence(node: ts.Node): DeclarationEvidence {
	const file = node.getSourceFile()
	const sourcePath = file.canonicalSourceFileName ?? file.fileName
	const range = { pos: node.getStart(file), end: node.getEnd() }
	const kind = declarationKind(node)
	if (!file.contentMapper)
		return { sourcePath, kind, range: { start: range.pos, end: range.end } }
	const mapped = file.spanMap?.virtualToOriginalSpan(range)
	return {
		sourcePath,
		kind,
		...(mapped && ts.SpanMap.isSingleSegment(mapped.fidelity)
			? { range: { start: mapped.range.pos, end: mapped.range.end } }
			: {}),
	}
}

function collectEvidence(
	references: ComponentReference[],
	file: ts.SourceFile,
	analysis: TypescriptAstAnalysis,
): AstroComponentEvidence[] {
	const names = new Map<string, ts.Node>()
	function visit(node: ts.Node) {
		if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
			names.set(`${node.getStart(file)}:${node.getEnd()}`, node)
		}
		node.forEachChild(visit)
	}
	visit(file)
	return references.map<AstroComponentEvidence>((reference) => {
		// A namespace member may have a separate mapping for its final name.
		const start = reference.range.start + reference.name.lastIndexOf(`.`) + 1
		const projections = file
			.spanMap!.originalToVirtualSpans(
				{ pos: start, end: reference.range.end },
				ts.SpanMapFeature.Definition,
			)
			.filter(({ fidelity }) => ts.SpanMap.isSingleSegment(fidelity))
		if (projections.length === 0)
			return { ...reference, status: `unmapped`, declarations: [] }
		const resolutions = projections.map(({ range }) => {
			const node = names.get(`${range.pos}:${range.end}`)
			return node ? analysis.resolveAliasedDeclarations(node) : []
		})
		const identities = resolutions.map((declarations) =>
			JSON.stringify(
				declarations
					.map((node) => {
						const evidence = declarationEvidence(node)
						// Declarations without mappings in the same generated file are still
						// distinct symbols. Do not collapse them to a shared file link.
						return evidence.range
							? JSON.stringify(evidence)
							: `${node.getSourceFile().fileName}:${node.getStart()}:${node.getEnd()}`
					})
					.toSorted(),
			),
		)
		if (new Set(identities).size > 1)
			return { ...reference, status: `ambiguous`, declarations: [] }
		const declarations = (resolutions[0] ?? []).map(declarationEvidence)
		return {
			...reference,
			status: declarations.length ? `resolved` : `unresolved`,
			declarations,
		}
	})
}

/**
 * Experimental source-only API. The template parser supplies the entire story;
 * mapped TypeScript supplies navigation evidence, never render or ownership facts.
 * Callers must explicitly enable external code for trusted project mappers.
 */
export function analyzeAstroSemanticEvidence(
	options: AnalyzeAstroOptions &
		TypescriptRuntimeOptions & {
			filePath: string
			typescriptSource?: TypescriptAstSourceOptions
		},
	session?: TypescriptAstSession,
): AstroSemanticResult {
	const renderStory = analyzeAstroRenderStory(options)
	const references = componentReferences(options.sourceText)
	const ownedSession = session ? undefined : createTypescriptAstSession(options)
	const activeSession = session ?? ownedSession!
	try {
		return activeSession.withSourceFile<AstroSemanticResult>(
			options.sourceText,
			options.filePath,
			(file, analysis) => {
				if (
					!file.contentMapper ||
					!file.spanMap?.segments.length ||
					file.originalText !== options.sourceText ||
					analysis.hasSyntacticErrors?.()
				) {
					return {
						renderStory,
						semantics: {
							status: `unavailable`,
							reason: `No current content-mapped source is available.`,
						},
					}
				}
				return {
					renderStory,
					semantics: {
						status: `available`,
						components: collectEvidence(references, file, analysis),
					},
				}
			},
			options.typescriptSource,
		)
	} catch (error) {
		return {
			renderStory,
			semantics: {
				status: `unavailable`,
				reason: error instanceof Error ? error.message : String(error),
			},
		}
	} finally {
		ownedSession?.close()
	}
}
