import { analyzeAstroRenderStory } from "./analyze-astro.ts"
import { analyzeTsxRenderStory } from "./analyze-tsx.ts"
import type { RenderStory } from "./diagnostics.ts"
import { renderSourceKindFromPath } from "./render-source.ts"
import type { TypescriptAstSession } from "./typescript-ast.ts"

export type AnalyzeRenderSourceOptions = {
	sourcePath: string
	sourceText: string
	componentName?: string
	scopeToCssClassRoots?: boolean
	typescriptSdkPath?: string
}

export function analyzeRenderStory(
	options: AnalyzeRenderSourceOptions,
	typescriptSession?: TypescriptAstSession,
): RenderStory {
	const kind = renderSourceKindFromPath(options.sourcePath)

	if (kind === `astro`) {
		return analyzeAstroRenderStory({
			filePath: options.sourcePath,
			sourceText: options.sourceText,
			...(options.componentName
				? { componentName: options.componentName }
				: {}),
			...(options.scopeToCssClassRoots === undefined
				? {}
				: { scopeToCssClassRoots: options.scopeToCssClassRoots }),
		})
	}

	if (kind === `tsx`) {
		return analyzeTsxRenderStory(
			{
				filePath: options.sourcePath,
				sourceText: options.sourceText,
				...(options.componentName
					? { componentName: options.componentName }
					: {}),
				...(options.scopeToCssClassRoots === undefined
					? {}
					: { scopeToCssClassRoots: options.scopeToCssClassRoots }),
				...(options.typescriptSdkPath
					? { typescriptSdkPath: options.typescriptSdkPath }
					: {}),
			},
			typescriptSession,
		)
	}

	throw new Error(
		`Unsupported render story source "${options.sourcePath}"; expected a .tsx or .astro file.`,
	)
}
