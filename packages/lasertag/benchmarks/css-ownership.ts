import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
	cpSync,
	existsSync,
	readFileSync,
	readdirSync,
	symlinkSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
	analyzeCssOwnershipEvidence,
	type CssOwnershipResult,
} from "../src/refractor/css-ownership-evidence.ts"
import { analyzeRenderStory } from "../src/refractor/analyze-render-source.ts"
import { analyzeCssModuleSelectors } from "../src/refractor/analyze-css-module.ts"
import { createTypescriptAstSession } from "../src/refractor/typescript-ast.ts"
import {
	createCssReachabilityDiagnostics,
	validateRenderSourceCssReachability,
} from "../src/refractor/validate-css-reachability.ts"
import { createDeadSelectorCleanupRanges } from "../src/lsp/code-actions.ts"
import { createCssModuleCompletionItems } from "../src/lsp/completions.ts"
import {
	createCssMapperProject,
	cssMapperPath,
} from "../tests/private/refractor/fixtures/css-project.ts"
import { officialAstroMapperPath } from "../tests/public/lsp/fixtures/astro-project.ts"

const args = process.argv.slice(2)
if (
	args[0] !== `--runExternalCode` ||
	(args.length !== 1 && (args.length !== 3 || args[1] !== `--iterations`))
)
	throw new Error(
		`Usage: pnpm --filter lasertag benchmark:css --runExternalCode [--iterations 5]`,
	)
const iterations = Number(args[2] ?? 5)
assert(
	Number.isInteger(iterations) && iterations >= 2,
	`Use at least two iterations.`,
)

const site = process.env.LASERTAG_BENCHMARK_SITE_PATH
	? path.resolve(process.env.LASERTAG_BENCHMARK_SITE_PATH)
	: fileURLToPath(new URL(`../../../apps/lasertagcss.com/`, import.meta.url))
assert(
	existsSync(path.join(site, `src`)) &&
		existsSync(path.join(site, `node_modules`)),
	`Set LASERTAG_BENCHMARK_SITE_PATH to an installed Lasertag website checkout.`,
)
using project = createCssMapperProject()
const copiedSite = path.join(project.root, `apps`, `lasertagcss.com`)
cpSync(path.join(site, `src`), path.join(copiedSite, `src`), {
	recursive: true,
})
if (existsSync(path.join(site, `.astro`)))
	cpSync(path.join(site, `.astro`), path.join(copiedSite, `.astro`), {
		recursive: true,
	})
symlinkSync(
	path.join(site, `node_modules`),
	path.join(copiedSite, `node_modules`),
	`junction`,
)
symlinkSync(
	path.resolve(site, `../../assets`),
	path.join(project.root, `assets`),
	`junction`,
)
cpSync(path.join(site, `package.json`), path.join(copiedSite, `package.json`))
const config = JSON.parse(
	readFileSync(path.join(site, `tsconfig.json`), `utf8`),
)
config.contentMappers = [
	{ package: cssMapperPath, extensions: [`.module.css`] },
	{ package: officialAstroMapperPath, extensions: [`.astro`] },
]
project.write(`apps/lasertagcss.com/tsconfig.json`, JSON.stringify(config))

const inputs = readdirSync(path.join(copiedSite, `src`), {
	recursive: true,
	encoding: `utf8`,
})
	.filter((name) => /\.(tsx|astro)$/.test(name))
	.sort()
	.flatMap((name) => {
		const sourcePath = path.join(copiedSite, `src`, name)
		const cssPath = sourcePath.replace(/\.(tsx|astro)$/, `.module.css`)
		return existsSync(cssPath)
			? [
					{
						name,
						sourcePath,
						sourceText: readFileSync(sourcePath, `utf8`),
						cssPath,
						cssSource: readFileSync(cssPath, `utf8`),
						runExternalCode: true,
					},
				]
			: []
	})
assert(inputs.length > 0)
function outputs(
	input: (typeof inputs)[number],
	renderStory: CssOwnershipResult[`renderStory`],
) {
	const diagnostics = createCssReachabilityDiagnostics({
		renderStory,
		cssSource: input.cssSource,
		selectorAnalyses: analyzeCssModuleSelectors(input.cssSource),
	})
	return {
		diagnostics,
		cleanup: createDeadSelectorCleanupRanges(
			input.cssSource,
			diagnostics.flatMap(({ range }) => (range ? [range] : [])),
		),
		completions: createCssModuleCompletionItems({
			renderStory,
			sourceText: input.cssSource,
			offset: input.cssSource.indexOf(`{`) + 1,
		}),
	}
}
const baselines = inputs.map((input) => {
	const baseline = validateRenderSourceCssReachability(input)
	return {
		story: baseline.renderStory,
		...outputs(input, baseline.renderStory),
	}
})
function verify(result: CssOwnershipResult, index: number) {
	const input = inputs[index]!
	const baseline = baselines[index]!
	assert.deepEqual(
		result.renderStory,
		baseline.story,
		`${input.name}: story changed`,
	)
	assert.deepEqual(
		outputs(input, result.renderStory),
		{
			diagnostics: baseline.diagnostics,
			cleanup: baseline.cleanup,
			completions: baseline.completions,
		},
		`${input.name}: CSS behavior changed`,
	)
	if (result.ownership.status !== `available`)
		throw new Error(`${input.name}: ${result.ownership.reason}`)
	// Every authored conventional attachment must be represented, even unresolved.
	assert.equal(
		result.ownership.attachments.filter(
			({ expression }) => expression === `css.class`,
		).length,
		[...input.sourceText.matchAll(/\bcss\.class\b/g)].length,
		`${input.name}: omitted reference`,
	)
	for (const reference of result.ownership.attachments) {
		assert.equal(
			input.sourceText.slice(reference.range.start, reference.range.end),
			reference.expression,
		)
		for (const target of reference.targets) {
			if (target.status !== `sibling` && target.status !== `foreign`) continue
			assert(target.range)
			assert.equal(
				readFileSync(target.sourcePath, `utf8`).slice(
					target.range.start,
					target.range.end,
				),
				`class`,
			)
			if (target.status === `sibling`)
				assert.equal(target.sourcePath, input.cssPath)
		}
	}
}
function measure<T>(run: () => T) {
	const start = performance.now()
	const value = run()
	return { value, ms: performance.now() - start }
}
function timings(samples: number[]) {
	const sorted = samples.toSorted((a, b) => a - b)
	return {
		samples: samples.length,
		medianMs: Number(
			(
				(sorted[Math.floor((sorted.length - 1) / 2)]! +
					sorted[Math.floor(sorted.length / 2)]!) /
				2
			).toFixed(3),
		),
		p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1]!.toFixed(3)),
	}
}
const baselineTimes: number[] = [],
	sharedBaselineTimes: number[] = [],
	coldTimes: number[] = [],
	reusedTimes: number[] = []
let results: CssOwnershipResult[] = []
for (let iteration = 0; iteration < iterations; iteration++) {
	baselineTimes.push(
		measure(() => inputs.map((input) => analyzeRenderStory(input))).ms,
	)
	const cold = measure(() =>
		inputs.map((input) => analyzeCssOwnershipEvidence(input)),
	)
	cold.value.forEach(verify)
	coldTimes.push(cold.ms)
}
using baselineSession = createTypescriptAstSession()
for (let iteration = 0; iteration < iterations; iteration++) {
	const sample = measure(() =>
		inputs.map((input) => analyzeRenderStory(input, baselineSession)),
	)
	sample.value.forEach((story, index) =>
		assert.deepEqual(story, baselines[index]!.story),
	)
	sharedBaselineTimes.push(sample.ms)
}
using session = createTypescriptAstSession({ runExternalCode: true })
for (let iteration = 0; iteration < iterations; iteration++) {
	const sample = measure(() =>
		inputs.map((input) => analyzeCssOwnershipEvidence(input, session)),
	)
	sample.value.forEach(verify)
	reusedTimes.push(sample.ms)
	results = sample.value
}

// Latency starts from a populated session. Every edit has unique authored text;
// correctness checks and ordinary baseline generation remain outside the timer.
const editSamples = Math.max(30, iterations * 5)
const panel = inputs.find(({ name }) =>
	name.endsWith(`ResponsiveNavPanel.tsx`),
)!
const toggle = inputs.find(({ name }) => name.endsWith(`ToggleButton.tsx`))!
const layout = inputs.find(({ name }) => name.endsWith(`Layout.astro`))!
assert(panel && toggle && layout)
function expected(input: typeof panel) {
	const start = performance.now()
	const renderStory = analyzeRenderStory(input, baselineSession)
	const presentation = outputs(input, renderStory)
	return { renderStory, outputs: presentation, ms: performance.now() - start }
}
const work = {
	unchanged: Array.from({ length: editSamples }, () => ({
		input: panel,
		openFiles: new Map<string, string>(),
	})),
	tsxRenderEdit: Array.from({ length: editSamples }, (_, index) => ({
		input: {
			...panel,
			sourceText: panel.sourceText.replace(
				`{children}`,
				`<latency-probe data-step="${index}" />{children}`,
			),
		},
		openFiles: new Map<string, string>(),
	})),
	tsxImportEdit: Array.from({ length: editSamples }, (_, index) => ({
		input: {
			...panel,
			sourceText: panel.sourceText
				.replace(`import css from`, `import styles${index} from`)
				.replaceAll(`css.class`, `styles${index}.class`),
		},
		openFiles: new Map<string, string>(),
	})),
	astroRenderEdit: Array.from({ length: editSamples }, (_, index) => ({
		input: {
			...layout,
			sourceText: layout.sourceText.replace(
				`<page-content>`,
				`<page-content data-step="${index}">`,
			),
		},
		openFiles: new Map<string, string>(),
	})),
	cssOverlayEdit: Array.from({ length: editSamples }, (_, index) => {
		const cssSource = `/* edit ${index} */\n${panel.cssSource}\nmissing-root-${index}.class {}`
		return {
			input: { ...panel, cssSource },
			openFiles: new Map([[panel.cssPath, cssSource]]),
		}
	}),
	alternatingSourceEdits: Array.from({ length: editSamples }, (_, index) => {
		const source = index % 2 ? toggle : panel
		const sourceText = source.sourceText.replace(
			`{children}`,
			`<latency-probe data-step="${index}" />{children}`,
		)
		return {
			input: { ...source, sourceText },
			openFiles: new Map([[source.sourcePath, sourceText]]),
		}
	}),
}
const editLatency: Record<
	string,
	{
		analysis: ReturnType<typeof timings>
		ordinaryAnalysis: ReturnType<typeof timings>
		extraction: ReturnType<typeof timings>
		cssResults: ReturnType<typeof timings>
	}
> = {}
for (const [name, edits] of Object.entries(work)) {
	const original = inputs.find(
		({ sourcePath }) => sourcePath === edits[0]!.input.sourcePath,
	)!
	analyzeRenderStory(original, baselineSession)
	const baselines = edits.map(({ input }) => expected(input))
	analyzeCssOwnershipEvidence(
		{ ...original, typescriptSource: { openFiles: new Map() } },
		session,
	)
	const analysis: number[] = [],
		extraction: number[] = [],
		cssResults: number[] = []
	for (const [index, { input, openFiles }] of edits.entries()) {
		const start = performance.now()
		const result = analyzeCssOwnershipEvidence(
			{ ...input, typescriptSource: { openFiles } },
			session,
		)
		const extracted = performance.now()
		const presentation = outputs(input, result.renderStory)
		const end = performance.now()
		analysis.push(end - start)
		extraction.push(extracted - start)
		cssResults.push(end - extracted)
		assert.deepEqual(
			result.renderStory,
			baselines[index]!.renderStory,
			`${name}: edited story changed`,
		)
		assert.deepEqual(
			presentation,
			baselines[index]!.outputs,
			`${name}: edited CSS outputs changed`,
		)
		assert.equal(result.ownership.status, `available`)
		if (result.ownership.status !== `available`)
			throw new Error(`Unavailable edited ownership`)
		assert(result.ownership.attachments.length > 0)
		for (const reference of result.ownership.attachments) {
			assert.equal(
				reference.status,
				`sibling`,
				`${name}: lost stylesheet identity`,
			)
			for (const target of reference.targets) {
				assert.equal(target.sourcePath, input.cssPath)
				assert(target.range)
				assert.equal(
					input.cssSource.slice(target.range.start, target.range.end),
					`class`,
					`${name}: stale CSS declaration range`,
				)
			}
		}
	}
	editLatency[name] = {
		analysis: timings(analysis),
		ordinaryAnalysis: timings(baselines.map(({ ms }) => ms)),
		extraction: timings(extraction),
		cssResults: timings(cssResults),
	}
}
const references = results.flatMap((result, index) =>
	result.ownership.status === `available`
		? result.ownership.attachments.map((reference) => ({
				file: inputs[index]!.name.replaceAll(path.sep, `/`),
				...reference,
				targets: reference.targets.map((target) => ({
					...target,
					sourcePath: path
						.relative(copiedSite, target.sourcePath)
						.replaceAll(path.sep, `/`),
				})),
			}))
		: [],
)
const hash = createHash(`sha256`)
for (const input of inputs)
	hash
		.update(input.name)
		.update(`\0`)
		.update(input.sourceText)
		.update(`\0`)
		.update(input.cssSource)
		.update(`\0`)
const readVersion = (root: string) =>
	JSON.parse(readFileSync(path.join(root, `package.json`), `utf8`)).version
console.log(
	JSON.stringify(
		{
			versions: {
				node: process.version,
				typescript: readVersion(
					fileURLToPath(new URL(`../node_modules/typescript`, import.meta.url)),
				),
				cssMapper: readVersion(cssMapperPath),
				astroMapper: readVersion(officialAstroMapperPath),
			},
			corpus: {
				project: `apps/lasertagcss.com`,
				sha256: hash.digest(`hex`),
				pairs: inputs.length,
				tsx: inputs.filter(({ name }) => name.endsWith(`.tsx`)).length,
				astro: inputs.filter(({ name }) => name.endsWith(`.astro`)).length,
			},
			verification: {
				identicalStories: true,
				identicalCssDiagnostics: true,
				identicalCleanup: true,
				identicalCompletions: true,
				allConventionalReferencesAccountedFor: true,
				authoredCssRangesVerified: true,
				editedStoriesAndCssOutputsIdentical: true,
			},
			coverage: Object.fromEntries(
				[
					`sibling`,
					`foreign`,
					`ambient`,
					`non-css`,
					`unmapped`,
					`unverified`,
					`unresolved`,
					`ambiguous`,
				].map((status) => [
					status,
					references.filter((reference) => reference.status === status).length,
				]),
			),
			timings: {
				ordinaryCorpus: timings(baselineTimes),
				ordinaryWithSharedSession: timings(sharedBaselineTimes),
				evidenceWithFreshSessionPerFile: timings(coldTimes),
				evidenceWithSharedSession: timings(reusedTimes),
			},
			references,
			editLatency,
			editWorkloads: {
				samplesPerWorkload: editSamples,
				tsx: panel.name,
				alternateTsx: toggle.name,
				astro: layout.name,
				includes: [
					`story`,
					`ownership`,
					`diagnostics`,
					`completions`,
					`cleanup`,
				],
				excludes: [
					`editor debounce`,
					`LSP transport`,
					`correctness assertions`,
				],
			},
		},
		null,
		2,
	),
)
