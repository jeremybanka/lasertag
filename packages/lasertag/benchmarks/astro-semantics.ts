import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
	cpSync,
	existsSync,
	readFileSync,
	readdirSync,
	symlinkSync,
} from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "@astrojs/compiler/sync"
import type { Node as AstroNode } from "@astrojs/compiler/types"

import { analyzeAstroRenderStory } from "../src/refractor/analyze-astro.ts"
import { analyzeCssModuleSelectors } from "../src/refractor/analyze-css-module.ts"
import {
	analyzeAstroSemanticEvidence,
	type AstroSemanticResult,
} from "../src/refractor/astro-semantic-evidence.ts"
import { scopeRenderStoryToCssClassRoots } from "../src/refractor/render-story-root.ts"
import { createTypescriptAstSession } from "../src/refractor/typescript-ast.ts"
import {
	createCssReachabilityDiagnostics,
	validateRenderSourceCssReachability,
} from "../src/refractor/validate-css-reachability.ts"
import {
	createOfficialAstroProject,
	officialAstroMapperPath,
} from "../tests/public/lsp/fixtures/astro-project.ts"

const args = process.argv.slice(2)
if (
	args[0] !== `--runExternalCode` ||
	(args.length !== 1 && (args.length !== 3 || args[1] !== `--iterations`))
) {
	throw new Error(
		`Usage: pnpm --filter lasertag benchmark:astro --runExternalCode [--iterations 10]`,
	)
}
const iterations = Number(args[2] ?? 10)
assert(
	Number.isInteger(iterations) && iterations >= 2,
	`Use at least two iterations.`,
)

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
		p95Ms: Number(
			sorted[
				Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
			]!.toFixed(3),
		),
	}
}

// Copy authored inputs and retain installed dependencies. Never enable mappers
// in the site's real tsconfig or overwrite its working files.
const site = process.env.LASERTAG_BENCHMARK_SITE_PATH
	? path.resolve(process.env.LASERTAG_BENCHMARK_SITE_PATH)
	: fileURLToPath(new URL(`../../../apps/lasertagcss.com/`, import.meta.url))
assert(
	existsSync(path.join(site, `src`)) &&
		existsSync(path.join(site, `node_modules`)),
	`Set LASERTAG_BENCHMARK_SITE_PATH to an installed Lasertag website checkout.`,
)
using project = createOfficialAstroProject()
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
	{ package: officialAstroMapperPath, extensions: [`.astro`] },
]
project.write(`apps/lasertagcss.com/tsconfig.json`, JSON.stringify(config))

const inputs = readdirSync(path.join(copiedSite, `src`), {
	recursive: true,
	encoding: `utf8`,
})
	.filter((name) => name.endsWith(`.astro`))
	.sort()
	.map((name) => {
		const filePath = path.join(copiedSite, `src`, name)
		const cssPath = filePath.replace(/\.astro$/, `.module.css`)
		return {
			name: name.replaceAll(path.sep, `/`),
			filePath,
			sourceText: readFileSync(filePath, `utf8`),
			cssSource: existsSync(cssPath)
				? readFileSync(cssPath, `utf8`)
				: undefined,
		}
	})
assert(inputs.length > 0)

function componentNames(node: AstroNode): string[] {
	return [
		...(node.type === `component` ? [node.name] : []),
		...(`children` in node ? node.children.flatMap(componentNames) : []),
	]
}
const baselines = inputs.map((input) => ({
	story: analyzeAstroRenderStory(input),
	componentNames: componentNames(parse(input.sourceText, {}).ast),
	diagnostics:
		input.cssSource === undefined
			? undefined
			: validateRenderSourceCssReachability({
					sourcePath: input.filePath,
					sourceText: input.sourceText,
					cssSource: input.cssSource,
				}).diagnostics,
}))

function checkResult(result: AstroSemanticResult, index: number) {
	const input = inputs[index]!
	const baseline = baselines[index]!
	assert.deepEqual(
		result.renderStory,
		baseline.story,
		`${input.name}: story changed`,
	)
	assert.equal(
		result.semantics.status,
		`available`,
		`${input.name}: mapper unavailable`,
	)
	if (input.cssSource !== undefined) {
		assert.deepEqual(
			createCssReachabilityDiagnostics({
				renderStory: scopeRenderStoryToCssClassRoots(result.renderStory, {
					missingAttachment: `opaque`,
				}),
				cssSource: input.cssSource,
				selectorAnalyses: analyzeCssModuleSelectors(input.cssSource),
			}),
			baseline.diagnostics,
			`${input.name}: CSS decisions changed`,
		)
	}
	if (result.semantics.status === `available`) {
		assert.deepEqual(
			result.semantics.components.map(({ name }) => name),
			baseline.componentNames,
			`${input.name}: missing component references`,
		)
		for (const reference of result.semantics.components) {
			assert.equal(
				input.sourceText.slice(reference.range.start, reference.range.end),
				reference.name,
			)
			for (const declaration of reference.declarations) {
				const source = readFileSync(declaration.sourcePath, `utf8`)
				if (declaration.range) {
					assert(
						declaration.range.start >= 0 &&
							declaration.range.end <= source.length,
					)
					assert(declaration.range.end > declaration.range.start)
				}
			}
		}
	}
}

const cold: number[] = []
const coldFile: number[] = []
const warmCorpus: number[] = []
const parserCorpus: number[] = []
const warmFile: number[] = []
const unsavedFile: number[] = []
let results: AstroSemanticResult[] = []
for (let round = 0; round < iterations; round++) {
	{
		using session = createTypescriptAstSession({ runExternalCode: true })
		const sample = measure(() =>
			analyzeAstroSemanticEvidence(inputs.at(-1)!, session),
		)
		coldFile.push(sample.ms)
		checkResult(sample.value, inputs.length - 1)
	}
	// Cold means a new TypeScript process/session, with OS/package caches warm.
	using session = createTypescriptAstSession({ runExternalCode: true })
	const initial = measure(() =>
		inputs.map((input) => analyzeAstroSemanticEvidence(input, session)),
	)
	cold.push(initial.ms)
	initial.value.forEach(checkResult)
	results = initial.value
	// Alternate measurement order to reduce systematic warm-up bias.
	const parser = () =>
		parserCorpus.push(measure(() => inputs.map(analyzeAstroRenderStory)).ms)
	const mapped = () => {
		const sample = measure(() =>
			inputs.map((input) => analyzeAstroSemanticEvidence(input, session)),
		)
		warmCorpus.push(sample.ms)
		sample.value.forEach(checkResult)
	}
	if (round % 2 === 0) {
		parser()
		mapped()
	} else {
		mapped()
		parser()
	}
	// The last visited file is the home page: distinguish switching roots from
	// repeated requests and unsaved edits of the currently open document.
	const input = inputs.at(-1)!
	const repeated = measure(() => analyzeAstroSemanticEvidence(input, session))
	warmFile.push(repeated.ms)
	checkResult(repeated.value, inputs.length - 1)
	const edited = {
		...input,
		sourceText: `${input.sourceText}\n<!-- unsaved ${round} 🌱 -->`,
	}
	const changed = measure(() => analyzeAstroSemanticEvidence(edited, session))
	unsavedFile.push(changed.ms)
	assert.deepEqual(changed.value.renderStory, analyzeAstroRenderStory(edited))
	assert.deepEqual(changed.value.semantics, repeated.value.semantics)
}

function displayPath(sourcePath: string) {
	if (sourcePath.startsWith(copiedSite + path.sep))
		return path.relative(copiedSite, sourcePath).replaceAll(path.sep, `/`)
	const normalized = sourcePath.replaceAll(path.sep, `/`)
	const index = normalized.lastIndexOf(`/node_modules/`)
	return index === -1 ? normalized : normalized.slice(index + 1)
}

const references = results.flatMap((result, index) =>
	result.semantics.status === `available`
		? result.semantics.components.map((reference) => ({
				source: inputs[index]!.name,
				name: reference.name,
				status: reference.status,
				declarations: reference.declarations.map((declaration) => ({
					...declaration,
					sourcePath: displayPath(declaration.sourcePath),
					kind: declaration.kind === `ambient` ? `type-declaration` : `source`,
				})),
			}))
		: [],
)
const requireFromMapper = createRequire(
	path.join(officialAstroMapperPath, `package.json`),
)
const readPackage = (filePath: string) =>
	JSON.parse(readFileSync(filePath, `utf8`))
const corpusHash = createHash(`sha256`)
corpusHash.update(readFileSync(path.join(site, `tsconfig.json`)))
for (const entry of readdirSync(path.join(copiedSite, `src`), {
	recursive: true,
	withFileTypes: true,
})
	.filter((entry) => entry.isFile())
	.sort((a, b) =>
		path
			.join(a.parentPath, a.name)
			.localeCompare(path.join(b.parentPath, b.name)),
	)) {
	const filePath = path.join(entry.parentPath, entry.name)
	corpusHash
		.update(path.relative(copiedSite, filePath))
		.update(`\0`)
		.update(readFileSync(filePath))
		.update(`\0`)
}
console.log(
	JSON.stringify(
		{
			environment: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				typescript: readPackage(
					fileURLToPath(import.meta.resolve(`typescript/package.json`)),
				).version,
				mapper: readPackage(path.join(officialAstroMapperPath, `package.json`))
					.version,
				astro2tsx: readPackage(
					requireFromMapper.resolve(`@astrojs/astro2tsx/package.json`),
				).version,
			},
			corpus: {
				project: `apps/lasertagcss.com`,
				sha256: corpusHash.digest(`hex`),
				files: inputs.length,
				cssPairs: inputs.filter((input) => input.cssSource !== undefined)
					.length,
			},
			verification: {
				identicalStories: true,
				identicalCssDiagnostics: true,
				allTemplateComponentsAccountedFor: true,
				authoredRangesWithinSource: true,
			},
			coverage: {
				references: references.length,
				resolvedToSource: references.filter(
					(reference) =>
						reference.status === `resolved` &&
						reference.declarations.some(
							(declaration) => declaration.kind === `source`,
						),
				).length,
				resolvedOnlyToTypes: references.filter(
					(reference) =>
						reference.status === `resolved` &&
						reference.declarations.length > 0 &&
						reference.declarations.every(
							(declaration) => declaration.kind === `type-declaration`,
						),
				).length,
				unresolved: references.filter(
					(reference) => reference.status !== `resolved`,
				).length,
				sourceWithRange: references.filter((reference) =>
					reference.declarations.some(
						(declaration) => declaration.kind === `source` && declaration.range,
					),
				).length,
			},
			timings: {
				parserCorpus: timings(parserCorpus),
				coldHomePage: timings(coldFile),
				coldMappedCorpus: timings(cold),
				warmMappedCorpus: timings(warmCorpus),
				warmHomePage: timings(warmFile),
				unsavedHomePage: timings(unsavedFile),
			},
			references,
		},
		null,
		2,
	),
)
