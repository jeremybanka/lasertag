import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import type { CssSelectorAnalysis } from "./analyze-css-module.ts"
import { analyzeRenderStory } from "./analyze-render-source.ts"
import { analyzeTsxRenderStory } from "./analyze-tsx.ts"
import type {
	CssReachabilityDiagnostic,
	Reachability,
	RenderStory,
	SelectorPath,
	SourceRange,
} from "./diagnostics.ts"
import { applyLasertagExpectErrorDirectives } from "./expect-error.ts"
import { canReachSelectorPath } from "./reachability.ts"
import { createRenderStoryEvidence } from "./render-story-evidence.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"
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

function combineReachability(results: Reachability[]): Reachability {
	if (results.includes(`reachable`)) return `reachable`
	if (results.includes(`unknown`)) return `unknown`

	return `unreachable`
}

export function analyzeCssReachability({
	cssSource,
	includeStoryEvidence = false,
	renderStory,
	selectorAnalyses,
}: CreateCssReachabilityDiagnosticsOptions): CssReachabilityAnalysis {
	const diagnostics: CssReachabilityDiagnostic[] = []
	const selectorReachability: CssSelectorReachabilityAnalysis[] = []

	for (const selectorAnalysis of selectorAnalyses) {
		const { result } = selectorAnalysis

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

		selectorReachability.push({
			paths,
			range: selectorAnalysis.range,
			reachability,
			resultKind: result.kind,
			selector: selectorAnalysis.selector,
		})

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

	return {
		diagnostics:
			cssSource === undefined
				? diagnostics
				: applyLasertagExpectErrorDirectives(cssSource, diagnostics),
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
