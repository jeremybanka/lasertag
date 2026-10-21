import { resolveSiblingRenderSource } from "../refractor/render-source.ts"
import {
	createCssAnalysisService,
	fallbackCssAnalysis,
	type CssAnalysisTask,
} from "../refractor/css-analysis.ts"
import type { CssOwnershipResult } from "../refractor/css-ownership-evidence.ts"
import type { TypescriptAstSession } from "../refractor/typescript-ast.ts"

export type PreparedCssAnalysis = CssAnalysisTask & CssOwnershipResult

export function currentCssAnalysis(
	prepared: PreparedCssAnalysis | undefined,
	sourcePath: string,
	sourceText: string,
	cssSource: string,
): CssOwnershipResult | undefined {
	return prepared?.sourcePath === sourcePath &&
		prepared.sourceText === sourceText &&
		prepared.cssSource === cssSource
		? prepared
		: undefined
}

export function createCliCssAnalysis(
	workerModule: string | URL,
	session: TypescriptAstSession,
	typescriptSdkPath?: string,
) {
	const service = createCssAnalysisService(workerModule)
	return {
		close: service.reset,
		async prepare(
			cssPath: string,
			fs: { fileExists(path: string): boolean; readFile(path: string): string },
		): Promise<PreparedCssAnalysis | undefined> {
			const sibling = resolveSiblingRenderSource(cssPath, (name) =>
				fs.fileExists(name),
			)
			if (sibling.kind !== `ready`) return
			const task: CssAnalysisTask = {
				cssPath,
				cssSource: fs.readFile(cssPath),
				sourcePath: sibling.source.path,
				sourceText: fs.readFile(sibling.source.path),
				...(typescriptSdkPath ? { typescriptSdkPath } : {}),
			}
			return {
				...task,
				...((await service.request(task)) ??
					fallbackCssAnalysis(task, session)),
			}
		},
	}
}
