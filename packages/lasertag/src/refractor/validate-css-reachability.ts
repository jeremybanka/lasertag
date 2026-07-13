import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import type { CssSelectorAnalysis } from "./analyze-css-module.ts"
import { analyzeRenderStory } from "./analyze-render-source.ts"
import { analyzeTsxRenderStory } from "./analyze-tsx.ts"
import type { CssReachabilityDiagnostic, RenderStory } from "./diagnostics.ts"
import { applyLasertagExpectErrorDirectives } from "./expect-error.ts"
import { canReachSelectorPath } from "./reachability.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"
import type { TypescriptAstSession } from "./typescript-ast.ts"

export type ValidateCssReachabilityOptions = {
	tsxSource: string
	cssSource: string
	tsxPath?: string
	cssPath?: string
	componentName?: string
	typescriptSdkPath?: string
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
}

export type CreateCssReachabilityDiagnosticsOptions = {
	cssSource?: string
	renderStory: RenderStory
	selectorAnalyses: CssSelectorAnalysis[]
}

function deadSelectorMessage(selector: string): string {
	return `Selector "${selector}" does not match any supported render story path.`
}

function impossibleLocalClassMessage(className: string): string {
	return `Local class ".${className}" is unreachable; lasertag CSS modules expose only "css.class".`
}

export function createCssReachabilityDiagnostics({
	cssSource,
	renderStory,
	selectorAnalyses,
}: CreateCssReachabilityDiagnosticsOptions): CssReachabilityDiagnostic[] {
	const diagnostics: CssReachabilityDiagnostic[] = []

	for (const selectorAnalysis of selectorAnalyses) {
		const { result } = selectorAnalysis

		if (result.kind === `unknown`) continue

		if (result.kind === `impossible-local-class`) {
			diagnostics.push({
				code: `impossible-local-class`,
				message: impossibleLocalClassMessage(result.className),
				selector: selectorAnalysis.selector,
				range: selectorAnalysis.range,
			})
			continue
		}

		if (
			result.paths.every(
				(path) => canReachSelectorPath(renderStory, path) === `unreachable`,
			)
		) {
			diagnostics.push({
				code: `dead-selector`,
				message: deadSelectorMessage(selectorAnalysis.selector),
				selector: selectorAnalysis.selector,
				range: selectorAnalysis.range,
			})
		}
	}

	return cssSource === undefined
		? diagnostics
		: applyLasertagExpectErrorDirectives(cssSource, diagnostics)
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
		renderStory,
		selectorAnalyses,
	})

	return { renderStory, diagnostics }
}
