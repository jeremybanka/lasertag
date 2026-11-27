import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import type {
	CssSelectorAnalysis,
	CssSelectorSegmentWithoutTag,
} from "./analyze-css-module.ts"
import { analyzeRenderStory } from "./analyze-render-source.ts"
import { analyzeTsxRenderStory } from "./analyze-tsx.ts"
import type {
	CssReachabilityDiagnostic,
	Reachability,
	RenderStory,
	SelectorPath,
	SourceRange,
	StoryChild,
} from "./diagnostics.ts"
import { applyLasertagSuppressionDirectives } from "./expect-error.ts"
import {
	canReachSelectorPath,
	findOwnershipBoundaryEvidence,
} from "./reachability.ts"
import type { OwnershipBoundaryEvidence } from "./reachability.ts"
import { createRenderStoryEvidence } from "./render-story-evidence.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"
import { isStandardIntrinsicTagName } from "./standard-intrinsic-tag-names.ts"
import type { TypescriptAstSession } from "./typescript-ast.ts"

export type ValidateCssReachabilityOptions = {
	tsxSource: string
	cssSource: string
	tsxPath?: string
	cssPath?: string
	componentName?: string
	typescriptSdkPath?: string
	includeStoryEvidence?: boolean
}

export type ValidateCssReachabilityResult = {
	renderStory: RenderStory
	diagnostics: CssReachabilityDiagnostic[]
}

export type ValidateRenderSourceCssReachabilityOptions = {
	sourcePath: string
	sourceText: string
	cssSource: string
	cssPath?: string
	componentName?: string
	typescriptSdkPath?: string
	includeStoryEvidence?: boolean
}

export type CreateCssReachabilityDiagnosticsOptions = {
	cssSource?: string
	includeStoryEvidence?: boolean
	renderStory: RenderStory
	selectorAnalyses: CssSelectorAnalysis[]
}

export type CssSelectorReachabilityAnalysis = {
	paths: Array<{
		path: SelectorPath
		reachability: Reachability
	}>
	range: SourceRange
	reachability: Reachability | `not-applicable`
	reason?: string
	resultKind: CssSelectorAnalysis[`result`][`kind`]
	selector: string
}

export type CssReachabilityAnalysis = {
	diagnostics: CssReachabilityDiagnostic[]
	selectorReachability: CssSelectorReachabilityAnalysis[]
}

function deadSelectorMessage(selector: string): string {
	return `Selector "${selector}" does not match any supported render story path.`
}

function impossibleLocalClassMessage(className: string): string {
	return `Local class ".${className}" is unreachable; lasertag CSS modules expose only "css.class".`
}

const MAX_SUGGESTED_TAGS = 3

function withoutParentheses(text: string): string {
	let current = text
	let previous: string

	do {
		previous = current
		current = current.replace(/\([^()]*\)/g, ``)
	} while (current !== previous)

	return current
}

type SelectedAttribute = {
	name: string
	/** Present only for an exact `[name="value"]` match. */
	value?: string
}

function selectedAttributes(compound: string): SelectedAttribute[] {
	const pattern =
		/\[\s*([^\s~|^$*=\]]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?/g

	return [...compound.matchAll(pattern)].flatMap((match) => {
		const name = match[1]
		const value = match[2] ?? match[3] ?? match[4]

		if (!name) return []

		return [value === undefined ? { name } : { name, value }]
	})
}

function collectTagNames(
	children: readonly StoryChild[],
	attributes: readonly SelectedAttribute[] | undefined,
	tagNames: Set<string>,
): void {
	for (const child of children) {
		if (child.kind === `opaque`) continue
		if (child.kind === `choice`) {
			for (const alternative of child.alternatives) {
				collectTagNames(alternative, attributes, tagNames)
			}
			continue
		}

		// Without attributes, only the story's outermost elements are wanted.
		if (attributes === undefined) {
			tagNames.add(child.tagName)
			continue
		}

		const hasEveryAttribute = attributes.every((selected) =>
			child.attributes?.some(
				(attribute) =>
					attribute.name === selected.name &&
					// A dynamic value may be the selected one.
					(selected.value === undefined ||
						attribute.value === undefined ||
						attribute.value === selected.value),
			),
		)

		if (hasEveryAttribute) tagNames.add(child.tagName)

		collectTagNames(child.children, attributes, tagNames)
	}
}

function quotedAlternatives(alternatives: string[]): string {
	return alternatives.map((alternative) => `"${alternative}"`).join(` or `)
}

function segmentWithoutTagMessage(
	renderStory: RenderStory,
	{ opensNestedSelector, text: segment }: CssSelectorSegmentWithoutTag,
): string {
	const problem = `Selector segment "${segment}" names no tag, so it cannot be checked against the render story.`
	const structure = withoutParentheses(segment)
	const tagNames = new Set<string>()

	if (/\.class(?![-\w])/.test(structure)) {
		collectTagNames(renderStory.roots, undefined, tagNames)

		return tagNames.size > 0 && tagNames.size <= MAX_SUGGESTED_TAGS
			? `${problem} Name the root: ${quotedAlternatives([...tagNames].map((tagName) => `${tagName}${segment}`))}.`
			: `${problem} Put the component's root tag before it.`
	}

	const attributes = selectedAttributes(structure)

	if (attributes.length > 0) {
		collectTagNames(renderStory.roots, attributes, tagNames)

		if (tagNames.size > 0 && tagNames.size <= MAX_SUGGESTED_TAGS) {
			return `${problem} Name the element: ${quotedAlternatives([...tagNames].map((tagName) => `${tagName}${segment}`))}.`
		}
	}

	if (/^:(?:is|where)\(/.test(segment)) {
		return `${problem} Name a tag in every alternative.`
	}

	if (segment.startsWith(`:`)) {
		return opensNestedSelector
			? `${problem} Write "&${segment}" to qualify the parent element, or put the descendant's tag before it.`
			: `${problem} Put the element's tag before it, or "*" to match any element.`
	}

	return `${problem} Put the element's tag before it, or give the element its own custom tag and select that.`
}

function ownershipBoundaryMessage(selector: string): string {
	return `Selector "${selector}" may match DOM owned by children or an external component.`
}

function foreignComponentDescendantMessage(
	selector: string,
	evidence: Extract<
		OwnershipBoundaryEvidence,
		{ kind: `foreign-component-descendant` }
	>,
): string {
	return evidence.rootWasAsserted
		? `Selector "${selector}" crosses into DOM owned by foreign component ${evidence.componentName} beneath its asserted <${evidence.rootTagName}> root.`
		: `Selector "${selector}" crosses into DOM owned by foreign component ${evidence.componentName} beneath its <${evidence.rootTagName}> root.`
}

function foreignComponentRootMessage(
	selector: string,
	evidence: Extract<
		OwnershipBoundaryEvidence,
		{ kind: `foreign-component-root` }
	>,
): string {
	const optIn = isStandardIntrinsicTagName(evidence.rootTagName)
		? ` Use <${evidence.rootTagName}.${evidence.componentName} /> to explicitly opt into styling this root.`
		: ``

	return `Selector "${selector}" matches <${evidence.rootTagName}>, the root rendered by foreign component ${evidence.componentName}.${optIn}`
}

function selectorPathPrefix(path: SelectorPath, segmentIndex: number): string {
	const root = path[0]

	if (!root) return ``

	let prefix = `${root.tagName}.class`

	for (let index = 1; index <= segmentIndex; index += 1) {
		const segment = path[index]

		if (!segment) break

		prefix += segment.relation === `child` ? ` > ` : ` `
		prefix += segment.tagName
	}

	return prefix
}

type OpaqueCollision = {
	componentName: string
	prefix: string
	range: SourceRange
	rootTagName: string
	selectors: Set<string>
}

function opaqueCollisionMessage(collision: OpaqueCollision): string {
	const selectorCount = collision.selectors.size

	return selectorCount === 1
		? `Cannot verify ownership of "${collision.prefix}": ${collision.componentName} has an unknown rendered root and may also render <${collision.rootTagName}>. Declare its stable intrinsic root with <tag.${collision.componentName} /> or place it beneath an owned boundary.`
		: `Cannot verify ownership of selectors beginning at "${collision.prefix}": ${collision.componentName} has an unknown rendered root and may also render <${collision.rootTagName}>. This affects ${selectorCount} selectors. Declare its stable intrinsic root with <tag.${collision.componentName} /> or place it beneath an owned boundary.`
}

function combineReachability(results: Reachability[]): Reachability {
	if (results.includes(`reachable`)) return `reachable`
	if (results.includes(`unknown`)) return `unknown`

	return `unreachable`
}

function adoptionDiagnostics(
	renderStory: RenderStory,
): CssReachabilityDiagnostic[] {
	return renderStory.warnings.flatMap((warning) =>
		warning.code === `adoption-source-unavailable` ||
		warning.code === `invalid-adoption-directive` ||
		warning.code === `invalid-adoption-target`
			? [
					{
						code: warning.code,
						message: warning.message,
						...(warning.sourcePath
							? { renderSourcePath: warning.sourcePath }
							: {}),
						...(warning.range ? { renderSourceRange: warning.range } : {}),
						selector: `@lasertag-adopt-subtree`,
					},
				]
			: [],
	)
}

export function analyzeCssReachability({
	cssSource,
	includeStoryEvidence = false,
	renderStory,
	selectorAnalyses,
}: CreateCssReachabilityDiagnosticsOptions): CssReachabilityAnalysis {
	const diagnostics = adoptionDiagnostics(renderStory)
	const selectorReachability: CssSelectorReachabilityAnalysis[] = []
	const opaqueCollisions = new Map<string, OpaqueCollision>()
	const reportedSegmentsWithoutTag = new Set<string>()

	for (const selectorAnalysis of selectorAnalyses) {
		const { result } = selectorAnalysis

		for (const segment of selectorAnalysis.segmentsWithoutTag ?? []) {
			// A rule nested under a selector list is flattened once per parent.
			const segmentKey = `${selectorAnalysis.range.start}\0${segment.text}`

			if (reportedSegmentsWithoutTag.has(segmentKey)) continue

			reportedSegmentsWithoutTag.add(segmentKey)
			diagnostics.push({
				code: `selector-segment-without-tag`,
				message: segmentWithoutTagMessage(renderStory, segment),
				selector: selectorAnalysis.selector,
				range: selectorAnalysis.range,
			})
		}

		if (result.kind === `unknown`) {
			selectorReachability.push({
				paths: [],
				range: selectorAnalysis.range,
				reachability: `unknown`,
				reason: result.reason,
				resultKind: result.kind,
				selector: selectorAnalysis.selector,
			})
			continue
		}

		if (result.kind === `impossible-local-class`) {
			diagnostics.push({
				code: `impossible-local-class`,
				message: impossibleLocalClassMessage(result.className),
				selector: selectorAnalysis.selector,
				range: selectorAnalysis.range,
			})
			selectorReachability.push({
				paths: [],
				range: selectorAnalysis.range,
				reachability: `not-applicable`,
				reason: `local class .${result.className} is not exposed`,
				resultKind: result.kind,
				selector: selectorAnalysis.selector,
			})
			continue
		}

		const paths = result.paths.map((selectorPath) => ({
			path: selectorPath,
			reachability: canReachSelectorPath(renderStory, selectorPath),
		}))
		const reachability = combineReachability(
			paths.map((path) => path.reachability),
		)
		const ownershipEvidence = result.paths.flatMap((selectorPath) =>
			findOwnershipBoundaryEvidence(renderStory, selectorPath).map(
				(evidence) => ({
					evidence,
					path: selectorPath,
				}),
			),
		)

		selectorReachability.push({
			paths,
			range: selectorAnalysis.range,
			reachability,
			resultKind: result.kind,
			selector: selectorAnalysis.selector,
		})

		const seenOwnershipEvidence = new Set<string>()

		for (const { evidence, path } of ownershipEvidence) {
			const evidenceKey = JSON.stringify({ evidence, path })

			if (seenOwnershipEvidence.has(evidenceKey)) continue

			seenOwnershipEvidence.add(evidenceKey)

			if (evidence.kind === `opaque-component-root`) {
				const prefix = selectorPathPrefix(path, evidence.segmentIndex)
				const collisionKey = `${evidence.componentName}\0${prefix}`
				const collision = opaqueCollisions.get(collisionKey)

				if (collision) {
					collision.selectors.add(selectorAnalysis.selector)
					if (selectorAnalysis.range.start < collision.range.start) {
						collision.range = selectorAnalysis.range
					}
				} else {
					opaqueCollisions.set(collisionKey, {
						componentName: evidence.componentName,
						prefix,
						range: selectorAnalysis.range,
						rootTagName: evidence.rootTagName,
						selectors: new Set([selectorAnalysis.selector]),
					})
				}
				continue
			}

			if (evidence.kind === `foreign-component-root`) {
				diagnostics.push({
					code: `selector-matches-foreign-component-root`,
					message: foreignComponentRootMessage(
						selectorAnalysis.selector,
						evidence,
					),
					selector: selectorAnalysis.selector,
					range: selectorAnalysis.range,
				})
				continue
			}

			diagnostics.push({
				code: `selector-crosses-ownership-boundary`,
				message:
					evidence.kind === `foreign-component-descendant`
						? foreignComponentDescendantMessage(
								selectorAnalysis.selector,
								evidence,
							)
						: ownershipBoundaryMessage(selectorAnalysis.selector),
				selector: selectorAnalysis.selector,
				range: selectorAnalysis.range,
			})
		}

		if (reachability === `unreachable`) {
			const storyEvidence = includeStoryEvidence
				? createRenderStoryEvidence(renderStory, result.paths)
				: undefined

			diagnostics.push({
				code: `dead-selector`,
				message: deadSelectorMessage(selectorAnalysis.selector),
				selector: selectorAnalysis.selector,
				...(storyEvidence ? { storyEvidence } : {}),
				range: selectorAnalysis.range,
			})
		}
	}

	for (const collision of opaqueCollisions.values()) {
		diagnostics.push({
			code: `opaque-component-root-may-collide`,
			message: opaqueCollisionMessage(collision),
			range: collision.range,
			selector: collision.prefix,
		})
	}

	diagnostics.sort(
		(left, right) =>
			(left.range?.start ?? 0) - (right.range?.start ?? 0) ||
			(left.range?.end ?? 0) - (right.range?.end ?? 0),
	)

	return {
		diagnostics:
			cssSource === undefined
				? diagnostics
				: applyLasertagSuppressionDirectives(cssSource, diagnostics),
		selectorReachability,
	}
}

export function createCssReachabilityDiagnostics({
	cssSource,
	includeStoryEvidence,
	renderStory,
	selectorAnalyses,
}: CreateCssReachabilityDiagnosticsOptions): CssReachabilityDiagnostic[] {
	return analyzeCssReachability({
		...(cssSource === undefined ? {} : { cssSource }),
		...(includeStoryEvidence === undefined ? {} : { includeStoryEvidence }),
		renderStory,
		selectorAnalyses,
	}).diagnostics
}

export function validateCssReachability(
	options: ValidateCssReachabilityOptions,
	typescriptSession?: TypescriptAstSession,
): ValidateCssReachabilityResult {
	const tsxOptions = {
		sourceText: options.tsxSource,
		...(options.tsxPath ? { filePath: options.tsxPath } : {}),
		...(options.componentName ? { componentName: options.componentName } : {}),
		...(options.typescriptSdkPath
			? { typescriptSdkPath: options.typescriptSdkPath }
			: {}),
	}
	const renderStory = scopeRenderStoryToCssClassRoots(
		analyzeTsxRenderStory(tsxOptions, typescriptSession),
		{ missingAttachment: `opaque` },
	)
	const selectorAnalyses = analyzeCssModuleSelectors(options.cssSource)
	const diagnostics = createCssReachabilityDiagnostics({
		cssSource: options.cssSource,
		...(options.includeStoryEvidence === undefined
			? {}
			: { includeStoryEvidence: options.includeStoryEvidence }),
		renderStory,
		selectorAnalyses,
	})

	return { renderStory, diagnostics }
}

export function validateRenderSourceCssReachability(
	options: ValidateRenderSourceCssReachabilityOptions,
	typescriptSession?: TypescriptAstSession,
): ValidateCssReachabilityResult {
	const renderStory = scopeRenderStoryToCssClassRoots(
		analyzeRenderStory(
			{
				sourcePath: options.sourcePath,
				sourceText: options.sourceText,
				...(options.componentName
					? { componentName: options.componentName }
					: {}),
				...(options.typescriptSdkPath
					? { typescriptSdkPath: options.typescriptSdkPath }
					: {}),
			},
			typescriptSession,
		),
		{ missingAttachment: `opaque` },
	)
	const selectorAnalyses = analyzeCssModuleSelectors(options.cssSource)
	const diagnostics = createCssReachabilityDiagnostics({
		cssSource: options.cssSource,
		...(options.includeStoryEvidence === undefined
			? {}
			: { includeStoryEvidence: options.includeStoryEvidence }),
		renderStory,
		selectorAnalyses,
	})

	return { renderStory, diagnostics }
}
