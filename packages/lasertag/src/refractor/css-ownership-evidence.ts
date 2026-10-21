import { readFileSync } from "node:fs"
import path from "node:path"

import { parse } from "@astrojs/compiler/sync"
import type { Node as AstroNode } from "@astrojs/compiler/types"
import * as ts from "typescript/ast"

import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import { analyzeRenderStory } from "./analyze-render-source.ts"
import type { RenderStory, SourceRange } from "./diagnostics.ts"
import { hasCssClassAttachment } from "./render-story-root.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstAnalysis,
	type TypescriptAstSession,
	type TypescriptAstSourceOptions,
} from "./typescript-ast.ts"
import type { TypescriptRuntimeOptions } from "./typescript-runtime.ts"

export type CssOwnershipStatus =
	| `sibling`
	| `foreign`
	| `ambient`
	| `non-css`
	| `unmapped`
	| `unverified`
	| `unresolved`
	| `ambiguous`
export type CssOwnershipTarget = {
	sourcePath: string
	range?: SourceRange
	status: Exclude<CssOwnershipStatus, `unresolved` | `ambiguous`>
}
export type CssAttachmentEvidence = {
	expression: string
	range: SourceRange
	attribute: string
	/** An expression containing a reference does not prove the class is applied. */
	usage: `direct` | `expression`
	legacyExpressionRecognized: boolean
	status: CssOwnershipStatus
	targets: CssOwnershipTarget[]
}
export type CssOwnershipResult = {
	renderStory: RenderStory
	ownership:
		| {
				status: `available`
				expectedCssPath: string
				attachments: CssAttachmentEvidence[]
		  }
		| { status: `unavailable`; reason: string }
}
export type CssOwnershipOptions = TypescriptRuntimeOptions & {
	sourcePath: string
	sourceText: string
	componentName?: string
	scopeToCssClassRoots?: boolean
	expectedCssPath?: string
	typescriptSource?: TypescriptAstSourceOptions
}

type AttributeExpression = {
	range: SourceRange
	name: string
	expression: string
}
const classAttributes = new Set([`class`, `className`, `class:list`])

function authoredRange(
	node: ts.Node,
	file: ts.SourceFile,
): SourceRange | undefined {
	const range = { pos: node.getStart(file), end: node.getEnd() }
	if (!file.contentMapper) return { start: range.pos, end: range.end }
	const mapped = file.spanMap?.virtualToOriginalSpanForFeature(
		range,
		ts.SpanMapFeature.Definition,
	)
	return mapped && ts.SpanMap.isSingleSegment(mapped.fidelity)
		? { start: mapped.range.pos, end: mapped.range.end }
		: undefined
}

function astroAttributes(sourceText: string): AttributeExpression[] {
	const bytes = Buffer.from(sourceText)
	const attributes: AttributeExpression[] = []
	function visit(node: AstroNode) {
		if (`attributes` in node) {
			for (const attribute of node.attributes) {
				if (
					!classAttributes.has(attribute.name) ||
					attribute.kind !== `expression` ||
					!attribute.position
				)
					continue
				const start = bytes
					.subarray(0, attribute.position.start.offset)
					.toString().length
				const prefix = /^[^=]+\s*=\s*\{/.exec(sourceText.slice(start))?.[0]
				if (!prefix) continue
				const pos = start + prefix.length
				if (
					sourceText.slice(pos, pos + attribute.value.length) !==
						attribute.value ||
					sourceText[pos + attribute.value.length] !== `}`
				)
					continue
				attributes.push({
					name: attribute.name,
					expression: attribute.value,
					range: { start: pos, end: pos + attribute.value.length },
				})
			}
		}
		if (`children` in node) node.children.forEach(visit)
	}
	visit(parse(sourceText, { position: true }).ast)
	return attributes
}

function tsxAttributes(file: ts.SourceFile): AttributeExpression[] {
	const attributes: AttributeExpression[] = []
	function visit(node: ts.Node) {
		if (
			ts.isJsxAttribute(node) &&
			classAttributes.has(node.name.getText(file)) &&
			node.initializer &&
			ts.isJsxExpression(node.initializer) &&
			node.initializer.expression
		) {
			const expression = node.initializer.expression
			attributes.push({
				name: node.name.getText(file),
				expression: expression.getText(file),
				range: { start: expression.getStart(file), end: expression.getEnd() },
			})
		}
		node.forEachChild(visit)
	}
	visit(file)
	return attributes
}

function classMember(node: ts.Node): ts.Node | undefined {
	if (ts.isPropertyAccessExpression(node) && node.name.text === `class`)
		return node.name
	if (
		ts.isElementAccessExpression(node) &&
		ts.isStringLiteral(node.argumentExpression) &&
		node.argumentExpression.text === `class`
	)
		return node.argumentExpression
	return undefined
}

function isAmbient(node: ts.Node): boolean {
	if (node.getSourceFile().isDeclarationFile) return true
	for (
		let current: ts.Node | undefined = node;
		current;
		current = current.parent
	) {
		if (current.flags & ts.NodeFlags.Ambient) return true
	}
	return false
}

/** Structurally equal CSS export types can collapse a union to one property. */
function receiverProvenance(
	expression: ts.Expression,
	analysis: TypescriptAstAnalysis,
	stack = new Set<ts.Node>(),
): { paths: string[]; uncertain: boolean } {
	if (stack.has(expression) || stack.size >= 32)
		return { paths: [], uncertain: true }
	const next = new Set([...stack, expression])
	if (
		ts.isParenthesizedExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isTypeAssertion(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isSatisfiesExpression(expression)
	)
		return receiverProvenance(expression.expression, analysis, next)
	if (ts.isConditionalExpression(expression)) {
		const alternatives = [expression.whenTrue, expression.whenFalse].map(
			(value) => receiverProvenance(value, analysis, next),
		)
		return {
			paths: [...new Set(alternatives.flatMap(({ paths }) => paths))],
			uncertain: alternatives.some(({ uncertain }) => uncertain),
		}
	}
	if (
		!ts.isIdentifier(expression) &&
		!ts.isPropertyAccessExpression(expression) &&
		!ts.isElementAccessExpression(expression)
	)
		return { paths: [], uncertain: true }
	const declarations = analysis.resolveAliasedDeclarations(expression)
	const origins = declarations.map((declaration) => {
		const file = declaration.getSourceFile()
		const sourcePath = path.resolve(
			file.canonicalSourceFileName ?? file.fileName,
		)
		if (file.contentMapper && sourcePath.endsWith(`.module.css`))
			return { paths: [sourcePath], uncertain: false }
		if (
			ts.isVariableDeclaration(declaration) &&
			declaration.initializer &&
			declaration.parent.flags & ts.NodeFlags.Const
		)
			return receiverProvenance(declaration.initializer, analysis, next)
		return { paths: [], uncertain: true }
	})
	return {
		paths: [...new Set(origins.flatMap(({ paths }) => paths))],
		uncertain:
			origins.length === 0 || origins.some(({ uncertain }) => uncertain),
	}
}

function authoredClassToken(
	text: string,
	selector: SourceRange,
	range: SourceRange,
): boolean {
	if (
		text.slice(range.start, range.end) !== `class` ||
		text[range.start - 1] !== `.` ||
		/[-\w\\\u0080-\uFFFF]/.test(text[range.end] ?? ``)
	)
		return false
	let quote: string | undefined
	let brackets = 0
	for (let index = selector.start; index < selector.end; index++) {
		const character = text[index]
		if (character === `\\`) {
			index++
			continue
		}
		if (quote) {
			if (character === quote) quote = undefined
			continue
		}
		if (character === `"` || character === `'`) {
			quote = character
			continue
		}
		if (character === `/` && text[index + 1] === `*`) {
			const end = text.indexOf(`*/`, index + 2)
			if (end < 0 || end >= selector.end) return false
			index = end + 1
			continue
		}
		if (character === `[`) brackets++
		if (character === `]`) brackets--
		if (index === range.start - 1) return brackets === 0
	}
	return false
}

function targetEvidence(
	node: ts.Node,
	expectedCssPath: string,
	overlays: ReadonlyMap<string, string>,
): CssOwnershipTarget {
	const file = node.getSourceFile()
	const sourcePath = path.resolve(file.canonicalSourceFileName ?? file.fileName)
	const base = { sourcePath }
	// A generated CSS property lives in `declare const styles`; its mapping,
	// rather than the generated Ambient flag, must establish CSS provenance.
	if (!file.contentMapper)
		return { ...base, status: isAmbient(node) ? `ambient` : `non-css` }
	if (!sourcePath.endsWith(`.module.css`)) return { ...base, status: `non-css` }
	if (
		node.kind !== ts.SyntaxKind.PropertySignature &&
		node.kind !== ts.SyntaxKind.PropertyDeclaration
	)
		return { ...base, status: `unmapped` }
	const range = authoredRange(
		(node as ts.PropertySignatureDeclaration | ts.PropertyDeclaration).name,
		file,
	)
	if (!range) return { ...base, status: `unmapped` }
	try {
		const text = overlays.get(sourcePath) ?? readFileSync(sourcePath, `utf8`)
		if (file.originalText !== text) return { ...base, status: `unverified` }
		// The generic mapper also exports IDs and global names. Require an exact
		// authored `.class` token in a selector and conservatively reject globals.
		const selectors = analyzeCssModuleSelectors(text).filter(
			({ range: selector }) =>
				selector.start <= range.start && range.end <= selector.end,
		)
		if (
			selectors.length === 0 ||
			selectors.some(
				({ selector, range: selectorRange }) =>
					/:global\b|:export\b/.test(selector) ||
					!authoredClassToken(text, selectorRange, range),
			)
		)
			return { ...base, range, status: `unverified` }
		return {
			...base,
			range,
			status: sourcePath === expectedCssPath ? `sibling` : `foreign`,
		}
	} catch {
		return { ...base, status: `unverified` }
	}
}

function collectAttachments(
	file: ts.SourceFile,
	analysis: TypescriptAstAnalysis,
	options: CssOwnershipOptions,
	expectedCssPath: string,
): CssAttachmentEvidence[] {
	const attributes = file.contentMapper
		? astroAttributes(options.sourceText)
		: tsxAttributes(file)
	const overlays = new Map(
		[...(options.typescriptSource?.openFiles ?? [])].map(([name, text]) => [
			path.resolve(name),
			text,
		]),
	)
	const references = new Map<
		string,
		{
			range: SourceRange
			attribute: AttributeExpression
			targets: CssOwnershipTarget[][]
			receiverPaths: Set<string>
			uncertain: boolean
		}
	>()
	function visit(node: ts.Node) {
		const member = classMember(node)
		if (member) {
			const range = authoredRange(node, file)
			const attribute =
				range &&
				attributes.find(
					(candidate) =>
						candidate.range.start <= range.start &&
						range.end <= candidate.range.end,
				)
			if (range && attribute) {
				const key = `${range.start}:${range.end}`
				const reference = references.get(key) ?? {
					range,
					attribute,
					targets: [],
					receiverPaths: new Set<string>(),
					uncertain: false,
				}
				const declarations = analysis.resolveAliasedDeclarations(member)
				reference.targets.push(
					declarations.map((declaration) =>
						targetEvidence(declaration, expectedCssPath, overlays),
					),
				)
				if (
					ts.isPropertyAccessExpression(node) ||
					ts.isElementAccessExpression(node)
				) {
					const provenance = receiverProvenance(node.expression, analysis)
					for (const origin of provenance.paths)
						reference.receiverPaths.add(origin)
					reference.uncertain ||= provenance.uncertain
				}
				references.set(key, reference)
			}
		}
		node.forEachChild(visit)
	}
	visit(file)
	return [...references.values()]
		.map<CssAttachmentEvidence>(
			({
				range,
				attribute,
				targets: projections,
				receiverPaths,
				uncertain,
			}) => {
				const identities = projections.map((targets) =>
					JSON.stringify(
						targets.map((target) => JSON.stringify(target)).toSorted(),
					),
				)
				const targets = [
					...new Map(
						(projections[0] ?? []).map((target) => [
							JSON.stringify(target),
							target,
						]),
					).values(),
				]
				const statuses = new Set(targets.map((target) => target.status))
				const paths = new Set(targets.map((target) => target.sourcePath))
				const verifiedCss = targets.some(
					({ status }) => status === `sibling` || status === `foreign`,
				)
				const status =
					new Set(identities).size > 1 ||
					paths.size > 1 ||
					statuses.size > 1 ||
					(verifiedCss &&
						(receiverPaths.size > 1 ||
							[...receiverPaths].some((origin) => !paths.has(origin))))
						? `ambiguous`
						: verifiedCss && (uncertain || receiverPaths.size === 0)
							? `unverified`
							: (targets[0]?.status ?? `unresolved`)
				return {
					expression: options.sourceText.slice(range.start, range.end),
					range,
					attribute: attribute.name,
					usage:
						range.start === attribute.range.start &&
						range.end === attribute.range.end
							? `direct`
							: `expression`,
					legacyExpressionRecognized: hasCssClassAttachment({
						kind: `element`,
						tagName: `evidence`,
						children: [],
						attributes: [
							{
								name: attribute.name === `className` ? `class` : attribute.name,
								expression: attribute.expression,
							},
						],
					}),
					status,
					targets:
						status === `ambiguous`
							? []
							: status === `unverified` && verifiedCss
								? targets.map((target) => ({ ...target, status: `unverified` }))
								: targets,
				}
			},
		)
		.sort((a, b) => a.range.start - b.range.start)
}

/**
 * Reuse the native AST for ordinary story extraction. Generated component code
 * cannot establish public render semantics: use ordinary analysis if a story
 * query would depend on a content-mapped declaration.
 */
class MappedStoryDeclaration extends Error {}

function storyFromParsedSource(
	options: CssOwnershipOptions,
	file: ts.SourceFile,
	analysis: TypescriptAstAnalysis,
): RenderStory {
	if (file.contentMapper) return analyzeRenderStory(options)
	function check(declarations: ts.Node[]): ts.Node[] {
		if (declarations.some((node) => node.getSourceFile().contentMapper))
			throw new MappedStoryDeclaration()
		return declarations
	}
	const storyAnalysis: TypescriptAstAnalysis = {
		...analysis,
		resolveAliasedDeclarations: (node) =>
			check(analysis.resolveAliasedDeclarations(node)),
		...(analysis.resolveValueDeclarations
			? {
					resolveValueDeclarations: (name: string, node: ts.Node) =>
						check(analysis.resolveValueDeclarations!(name, node)),
				}
			: {}),
	}
	const parsedSession: TypescriptAstSession = {
		[Symbol.dispose]() {},
		close() {},
		withSourceFile: (_text, _path, use) => use(file, storyAnalysis),
	}
	try {
		return analyzeRenderStory(options, parsedSession)
	} catch (error) {
		if (!(error instanceof MappedStoryDeclaration)) throw error
		return analyzeRenderStory(options)
	}
}

/**
 * Semantic evidence used by opted-in CLI and LSP analysis.
 * Evidence describes stylesheet references, never permission to expand a subtree
 * or remove CSS. Structural policies remain authoritative.
 */
export function analyzeCssOwnershipEvidence(
	options: CssOwnershipOptions,
	session?: TypescriptAstSession,
): CssOwnershipResult {
	let renderStory = options.sourcePath.endsWith(`.astro`)
		? analyzeRenderStory(options)
		: undefined
	const ordinaryStory = () => (renderStory ??= analyzeRenderStory(options))
	const expectedCssPath = path.resolve(
		options.expectedCssPath ??
			options.sourcePath.replace(/\.(?:tsx|astro)$/, `.module.css`),
	)
	const ownedSession = session ? undefined : createTypescriptAstSession(options)
	try {
		return (session ?? ownedSession!).withSourceFile<CssOwnershipResult>(
			options.sourceText,
			options.sourcePath,
			(file, analysis) => {
				renderStory ??= storyFromParsedSource(options, file, analysis)
				if (
					analysis.hasSyntacticErrors?.() ||
					(options.sourcePath.endsWith(`.astro`) &&
						(!file.contentMapper || file.originalText !== options.sourceText))
				)
					return {
						renderStory: ordinaryStory(),
						ownership: {
							status: `unavailable`,
							reason: `No current parsed source is available.`,
						},
					}
				return {
					renderStory: ordinaryStory(),
					ownership: {
						status: `available`,
						expectedCssPath,
						attachments: collectAttachments(
							file,
							analysis,
							options,
							expectedCssPath,
						),
					},
				}
			},
			options.typescriptSource,
		)
	} catch (error) {
		return {
			renderStory: ordinaryStory(),
			ownership: {
				status: `unavailable`,
				reason: error instanceof Error ? error.message : String(error),
			},
		}
	} finally {
		ownedSession?.close()
	}
}
