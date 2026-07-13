import { Logger } from "takua"

import { createLasertagLspState } from "../src/lsp/state.ts"

const DEFAULT_ELEMENT_COUNT = 160
const DEFAULT_ITERATION_COUNT = 20

type BenchmarkOptions = {
	elementCount: number
	iterationCount: number
}

function positiveIntegerArgument(name: string, fallback: number): number {
	const argumentIndex = process.argv.indexOf(name)
	const rawValue =
		argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1]
	const value = Number(rawValue)

	return Number.isInteger(value) && value > 0 ? value : fallback
}

function benchmarkOptions(): BenchmarkOptions {
	return {
		elementCount: positiveIntegerArgument(`--elements`, DEFAULT_ELEMENT_COUNT),
		iterationCount: positiveIntegerArgument(
			`--iterations`,
			DEFAULT_ITERATION_COUNT,
		),
	}
}

function createAstroSource(elementCount: number): string {
	const children = Array.from(
		{ length: elementCount },
		(_, index) => `<benchmark-item-${index}><span /></benchmark-item-${index}>`,
	).join(`\n`)

	return `---
import Layout from "../layouts/Layout.astro"
import { ExternalIsland } from "../components/ExternalIsland"
import css from "./BenchmarkPanel.module.css"
---
<Layout>
	<ExternalIsland client:only />
	<benchmark-panel class={css.class}>
		${children}
	</benchmark-panel>
</Layout>`
}

function createCssSource(elementCount: number): string {
	const children = Array.from({ length: elementCount }, (_, index) => {
		return `
	> benchmark-item-${index} { > span {} }
	> missing-item-${index} {}`
	}).join(``)

	return `benchmark-panel.class {${children}
}`
}

function durationMs(run: () => void): number {
	const startedAt = performance.now()

	run()

	return performance.now() - startedAt
}

function averageMs(duration: number, iterationCount: number): number {
	return Number((duration / iterationCount).toFixed(3))
}

function runBenchmark(options: BenchmarkOptions): void {
	const logger = new Logger({ colorEnabled: false })
	const chronicle = logger.makeChronicle()
	const cssPath = `/benchmark/BenchmarkPanel.module.css`
	const astroPath = `/benchmark/BenchmarkPanel.astro`
	const cssSource = createCssSource(options.elementCount)
	const astroSource = createAstroSource(options.elementCount)
	const files = new Map([[astroPath, astroSource]])
	const state = createLasertagLspState({
		fileExists: (filePath) => files.has(filePath),
		readFile: (filePath) => {
			const sourceText = files.get(filePath)

			if (sourceText === undefined) {
				throw new Error(`Missing benchmark file: ${filePath}`)
			}

			return sourceText
		},
	})

	chronicle.mark(`benchmark started`)
	state.openDocument({
		languageId: `css`,
		path: cssPath,
		text: cssSource,
		uri: `file://${cssPath}`,
		version: 1,
	})
	const coldDiagnostics = state.getDiagnostics(cssPath)
	const coldTrace = state.getAnalysisTrace(cssPath)

	if (
		coldDiagnostics.length !== options.elementCount ||
		coldTrace.summary.selectorCount !== options.elementCount * 3 + 1 ||
		coldTrace.summary.unreachableSelectorCount !== options.elementCount
	) {
		throw new Error(
			`Benchmark fixture produced unexpected analysis results: ${JSON.stringify(
				{
					diagnosticCount: coldDiagnostics.length,
					selectorCount: coldTrace.summary.selectorCount,
					unreachableSelectorCount: coldTrace.summary.unreachableSelectorCount,
				},
			)}`,
		)
	}
	chronicle.mark(`cold analysis completed`)

	const diagnosticsDuration = durationMs(() => {
		for (let index = 0; index < options.iterationCount; index += 1) {
			state.openDocument({
				languageId: `css`,
				path: cssPath,
				text: cssSource,
				uri: `file://${cssPath}`,
				version: index + 2,
			})
			state.getDiagnostics(cssPath)
		}
	})
	chronicle.mark(`${options.iterationCount} diagnostics cycles`)

	const tracedDuration = durationMs(() => {
		for (let index = 0; index < options.iterationCount; index += 1) {
			state.openDocument({
				languageId: `css`,
				path: cssPath,
				text: cssSource,
				uri: `file://${cssPath}`,
				version: options.iterationCount + index + 2,
			})
			state.getDiagnostics(cssPath)
			state.getAnalysisTrace(cssPath)
		}
	})
	chronicle.mark(`${options.iterationCount} diagnostics and trace cycles`)
	chronicle.logMarks()

	logger.info(`benchmark`, `LSP analysis averages`, {
		diagnosticsAndTraceMs: averageMs(tracedDuration, options.iterationCount),
		diagnosticsMs: averageMs(diagnosticsDuration, options.iterationCount),
		elementCount: options.elementCount,
		iterationCount: options.iterationCount,
		overheadRatio: Number((tracedDuration / diagnosticsDuration).toFixed(2)),
		selectorCount: options.elementCount * 3 + 1,
	})
}

runBenchmark(benchmarkOptions())
