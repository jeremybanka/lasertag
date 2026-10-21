import type { CancellationToken } from "vscode-languageserver/node"

import { analyzeRenderStory } from "./analyze-render-source.ts"
import { analyzeCssModuleSelectors } from "./analyze-css-module.ts"
import {
	analyzeCssOwnershipEvidence,
	type CssOwnershipResult,
} from "./css-ownership-evidence.ts"
import { createMapperProcess } from "./mapper-process.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstSession,
} from "./typescript-ast.ts"
import {
	createCssReachabilityDiagnostics,
	validateRenderSourceCssReachability,
	type ValidateRenderSourceCssReachabilityOptions,
} from "./validate-css-reachability.ts"

export const CSS_ANALYSIS_WORKER = `lasertag-css-analysis`
export type CssAnalysisTask = {
	sourcePath: string
	sourceText: string
	cssPath: string
	cssSource: string
	/** CLI validation scopes during extraction; editor views retain the full story. */
	scopeToCssClassRoots?: boolean
	openFiles?: Array<[string, string]>
	diskRevision?: number
	typescriptSdkPath?: string
}

export function runCssAnalysisWorker(): void {
	let session: TypescriptAstSession | undefined
	let sdk: string | undefined
	let revision: number | undefined
	process.on(
		`message`,
		(request: { id: number; task: CssAnalysisTask } | { close: true }) => {
			if (`close` in request) {
				session?.close()
				process.disconnect?.()
				return
			}
			const { task } = request
			if (!session || sdk !== task.typescriptSdkPath) {
				session?.close()
				sdk = task.typescriptSdkPath
				session = createTypescriptAstSession({
					runExternalCode: true,
					...(sdk ? { typescriptSdkPath: sdk } : {}),
				})
			}
			const invalidate =
				revision !== undefined && revision !== task.diskRevision
			revision = task.diskRevision
			const openFiles = new Map(task.openFiles)
			openFiles.set(task.cssPath, task.cssSource)
			let result: CssOwnershipResult | undefined
			try {
				result = analyzeCssOwnershipEvidence(
					{
						...task,
						expectedCssPath: task.cssPath,
						scopeToCssClassRoots: task.scopeToCssClassRoots ?? false,
						typescriptSource: { openFiles, invalidate },
					},
					session,
				)
			} catch {
				// The caller falls back to ordinary analysis if the worker cannot parse.
				session.close()
				session = undefined
			}
			process.send?.({ id: request.id, result })
		},
	)
}

/** A bounded, reusable process keeps mapper execution off the consumer thread. */
export function createCssAnalysisService(
	workerModule: string | URL,
	timeoutMs = 10_000,
) {
	const worker = createMapperProcess<CssAnalysisTask, CssOwnershipResult>(
		workerModule,
		CSS_ANALYSIS_WORKER,
		timeoutMs,
	)
	return {
		reset: worker.reset,
		request: (task: CssAnalysisTask, token?: CancellationToken) =>
			worker.request(task, token),
	}
}

export function fallbackCssAnalysis(
	task: CssAnalysisTask,
	session?: TypescriptAstSession,
): CssOwnershipResult {
	return {
		renderStory: analyzeRenderStory(
			{ ...task, scopeToCssClassRoots: task.scopeToCssClassRoots ?? false },
			session,
		),
		ownership: {
			status: `unavailable`,
			reason: `CSS mapper analysis was unavailable; ordinary analysis was used.`,
		},
	}
}

/** Both modes use the existing scoping and CSS policy, including suppressions. */
export function validateCssAnalysis(
	options: ValidateRenderSourceCssReachabilityOptions,
	session: TypescriptAstSession,
	mapped?: CssOwnershipResult,
) {
	if (!mapped) return validateRenderSourceCssReachability(options, session)
	const renderStory = scopeRenderStoryToCssClassRoots(mapped.renderStory, {
		missingAttachment: `opaque`,
	})
	return {
		renderStory,
		diagnostics: createCssReachabilityDiagnostics({
			cssSource: options.cssSource,
			renderStory,
			selectorAnalyses: analyzeCssModuleSelectors(options.cssSource),
			...(options.includeStoryEvidence === undefined
				? {}
				: { includeStoryEvidence: options.includeStoryEvidence }),
		}),
	}
}
