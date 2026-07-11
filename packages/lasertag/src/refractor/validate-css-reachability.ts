import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import type { CssSelectorAnalysis } from "./analyze-css-module.ts"
import { analyzeTsxRenderStory } from "./analyze-tsx.ts"
import type { CssReachabilityDiagnostic, RenderStory } from "./diagnostics.ts"
import { applyLasertagExpectErrorDirectives } from "./expect-error.ts"
import { canReachSelectorPath } from "./reachability.ts"
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
	const renderStory = analyzeTsxRenderStory(tsxOptions, typescriptSession)
	const selectorAnalyses = analyzeCssModuleSelectors(options.cssSource)
	const diagnostics = createCssReachabilityDiagnostics({
		cssSource: options.cssSource,
		renderStory,
		selectorAnalyses,
	})

	return { renderStory, diagnostics }
}
