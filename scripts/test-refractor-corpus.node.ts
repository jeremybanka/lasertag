#!/usr/bin/env node
import { execFile } from "node:child_process"
import type { Dirent } from "node:fs"
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import * as ts from "typescript/unstable/ast"

import { analyzeTsxRenderStories } from "../packages/lasertag/src/refractor/analyze-tsx.ts"
import { createTsxSourceFile } from "../packages/lasertag/src/refractor/typescript-ast.ts"
import type {
	OpaqueStoryNode,
	RenderStory,
	SelectorPath,
	SourceRange,
	StoryChild,
	StoryNode,
} from "../packages/lasertag/src/refractor/diagnostics.ts"
import { canReachSelectorPath } from "../packages/lasertag/src/refractor/reachability.ts"

type IncludePattern = {
	from: string
	coverage: string[]
}

type RenovateConfig = {
	datasource: string
	packageName: string
	versioning: string
	extractVersion?: string
}

type CorpusProvider = {
	name: string
	description: string
	version: string
	renovate: RenovateConfig
	license: string
	maxFiles?: number
	include: IncludePattern[]
	source: unknown
}

type CorpusManifest = {
	providers: CorpusProvider[]
}

type ProviderMetadata = {
	name?: unknown
	version?: unknown
	files?: unknown
}

type RunnerOptions = {
	fetchMissing: boolean
	jsonPath: string
	markdownPath: string
	maxFileMs: number
	maxTotalMs: number
	providerNames: Set<string>
	report: boolean
	syntheticSelectorsPerFile: number
}

type CorpusFile = {
	provider: CorpusProvider
	relativePath: string
	filePath: string
}

type StoryStats = {
	elementCount: number
	maxDepth: number
	opaqueCount: number
	rootCount: number
}

type SyntheticStats = {
	negativeReachableFailures: number
	negativeUnknown: number
	positiveFailures: number
	selectorsChecked: number
}

type FileOkReport = {
	status: `ok`
	provider: string
	relativePath: string
	durationMs: number
	sourceBytes: number
	componentNames: string[]
	stats: StoryStats
	warningCodes: string[]
	opaqueReasons: CountEntry[]
	synthetic: SyntheticStats
	patterns: string[]
}

type FileFailedReport = {
	status: `failed`
	provider: string
	relativePath: string
	durationMs: number
	sourceBytes: number
	error: string
}

type FileReport = FileOkReport | FileFailedReport

type ProviderReport = {
	name: string
	version: string
	fileCount: number
	durationMs: number
	failures: number
}

type CountEntry = {
	name: string
	count: number
}

type ElementPath = {
	story: RenderStory
	path: SelectorPath
}

type CorpusFailure = {
	provider: string
	relativePath: string
	message: string
}

type CorpusReport = {
	schemaVersion: 1
	generatedAt: string
	options: {
		maxFileMs: number
		maxTotalMs: number
		providers: string[]
		syntheticSelectorsPerFile: number
	}
	totals: {
		durationMs: number
		elementCount: number
		failedFiles: number
		files: number
		opaqueCount: number
		providers: number
		syntheticNegativeReachableFailures: number
		syntheticPositiveFailures: number
		warnings: number
	}
	providers: ProviderReport[]
	opaqueReasons: CountEntry[]
	patterns: CountEntry[]
	warningCodes: CountEntry[]
	slowestFiles: Array<{
		provider: string
		relativePath: string
		durationMs: number
	}>
	failures: CorpusFailure[]
	files: FileReport[]
}

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, `..`)
const corpusRoot = path.join(
	workspaceRoot,
	`packages/lasertag/tests/private/refractor/corpus`,
)
const manifestPath = path.join(corpusRoot, `manifest.json`)
const providersRoot = path.join(corpusRoot, `providers`)
const reportsRoot = path.join(corpusRoot, `reports`)
const fetchScriptPath = path.join(scriptDir, `fetch-refractor-corpus.node.ts`)

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2))
	const manifest = await readManifest()
	const providers = selectProviders(manifest.providers, options.providerNames)

	if (providers.length === 0) {
		throw new Error(`No corpus providers were selected.`)
	}

	await ensureProviders(providers, options)
	const files = await collectCorpusFiles(providers)
	const report = await analyzeCorpus(files, providers, options)

	if (options.report) {
		await writeReports(report, options)
	}

	printSummary(report, options)

	if (report.failures.length > 0) {
		process.exitCode = 1
	}
}

function parseArgs(args: string[]): RunnerOptions {
	const providerNames = new Set<string>()
	const defaults = defaultReportPaths()
	let fetchMissing = true
	let jsonPath = defaults.jsonPath
	let markdownPath = defaults.markdownPath
	let maxFileMs = 1000
	let maxTotalMs = 60000
	let report = true
	let syntheticSelectorsPerFile = 25

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === `--no-fetch`) {
			fetchMissing = false
			continue
		}

		if (arg === `--no-report`) {
			report = false
			continue
		}

		if (arg === `--provider`) {
			const providerName = args[index + 1]
			if (!providerName) {
				throw new Error(`--provider requires a provider name.`)
			}

			providerNames.add(providerName)
			index += 1
			continue
		}

		if (arg?.startsWith(`--provider=`)) {
			providerNames.add(arg.slice(`--provider=`.length))
			continue
		}

		if (arg === `--json`) {
			jsonPath = readOptionValue(args, index, arg)
			index += 1
			continue
		}

		if (arg?.startsWith(`--json=`)) {
			jsonPath = arg.slice(`--json=`.length)
			continue
		}

		if (arg === `--markdown`) {
			markdownPath = readOptionValue(args, index, arg)
			index += 1
			continue
		}

		if (arg?.startsWith(`--markdown=`)) {
			markdownPath = arg.slice(`--markdown=`.length)
			continue
		}

		if (arg === `--max-file-ms`) {
			maxFileMs = parsePositiveNumber(readOptionValue(args, index, arg), arg)
			index += 1
			continue
		}

		if (arg?.startsWith(`--max-file-ms=`)) {
			maxFileMs = parsePositiveNumber(
				arg.slice(`--max-file-ms=`.length),
				`--max-file-ms`,
			)
			continue
		}

		if (arg === `--max-total-ms`) {
			maxTotalMs = parsePositiveNumber(readOptionValue(args, index, arg), arg)
			index += 1
			continue
		}

		if (arg?.startsWith(`--max-total-ms=`)) {
			maxTotalMs = parsePositiveNumber(
				arg.slice(`--max-total-ms=`.length),
				`--max-total-ms`,
			)
			continue
		}

		if (arg === `--synthetic-selectors-per-file`) {
			syntheticSelectorsPerFile = parsePositiveNumber(
				readOptionValue(args, index, arg),
				arg,
			)
			index += 1
			continue
		}

		if (arg?.startsWith(`--synthetic-selectors-per-file=`)) {
			syntheticSelectorsPerFile = parsePositiveNumber(
				arg.slice(`--synthetic-selectors-per-file=`.length),
				`--synthetic-selectors-per-file`,
			)
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	return {
		fetchMissing,
		jsonPath,
		markdownPath,
		maxFileMs,
		maxTotalMs,
		providerNames,
		report,
		syntheticSelectorsPerFile,
	}
}

function defaultReportPaths(): { jsonPath: string; markdownPath: string } {
	return {
		jsonPath: path.join(reportsRoot, `latest.json`),
		markdownPath: path.join(reportsRoot, `latest.md`),
	}
}

function readOptionValue(
	args: string[],
	index: number,
	optionName: string,
): string {
	const value = args[index + 1]

	if (!value) {
		throw new Error(`${optionName} requires a value.`)
	}

	return value
}

function parsePositiveNumber(value: string, optionName: string): number {
	const parsed = Number(value)

	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${optionName} must be a positive number.`)
	}

	return parsed
}

async function readManifest(): Promise<CorpusManifest> {
	return JSON.parse(await readFile(manifestPath, `utf8`)) as CorpusManifest
}

function selectProviders(
	providers: CorpusProvider[],
	providerNames: Set<string>,
): CorpusProvider[] {
	if (providerNames.size === 0) return providers

	const selectedProviders = providers.filter((provider) =>
		providerNames.has(provider.name),
	)
	const selectedNames = new Set(
		selectedProviders.map((provider) => provider.name),
	)
	const missingNames = [...providerNames].filter(
		(providerName) => !selectedNames.has(providerName),
	)

	if (missingNames.length > 0) {
		throw new Error(`Unknown corpus provider(s): ${missingNames.join(`, `)}`)
	}

	return selectedProviders
}

async function ensureProviders(
	providers: CorpusProvider[],
	options: RunnerOptions,
): Promise<void> {
	const staleProviders: CorpusProvider[] = []

	for (const provider of providers) {
		if (await providerNeedsFetch(provider)) {
			staleProviders.push(provider)
		}
	}

	if (staleProviders.length === 0) return

	if (!options.fetchMissing) {
		throw new Error(
			`Missing or stale corpus provider(s): ${staleProviders
				.map((provider) => provider.name)
				.join(`, `)}. Run pnpm refractor:corpus or omit --no-fetch.`,
		)
	}

	for (const provider of staleProviders) {
		console.log(`Fetching missing corpus provider ${provider.name}`)
		const { stderr, stdout } = await execFileAsync(
			fetchScriptPath,
			[`--provider`, provider.name],
			{
				cwd: workspaceRoot,
				maxBuffer: 10 * 1024 * 1024,
			},
		)

		if (stdout.trim()) console.log(stdout.trim())
		if (stderr.trim()) console.error(stderr.trim())
	}
}

async function providerNeedsFetch(provider: CorpusProvider): Promise<boolean> {
	const providerRoot = path.join(providersRoot, provider.name)
	const metadataPath = path.join(providerRoot, `metadata.json`)

	let metadata: ProviderMetadata

	try {
		metadata = JSON.parse(
			await readFile(metadataPath, `utf8`),
		) as ProviderMetadata
	} catch {
		return true
	}

	if (
		metadata.name !== provider.name ||
		metadata.version !== provider.version ||
		!Array.isArray(metadata.files) ||
		metadata.files.length === 0
	) {
		return true
	}

	for (const file of metadata.files) {
		if (typeof file !== `string`) return true

		try {
			await access(path.join(providerRoot, `files`, file))
		} catch {
			return true
		}
	}

	return false
}

async function collectCorpusFiles(
	providers: CorpusProvider[],
): Promise<CorpusFile[]> {
	const corpusFiles: CorpusFile[] = []

	for (const provider of providers) {
		const filesRoot = path.join(providersRoot, provider.name, `files`)
		const providerFiles = (await listFiles(filesRoot))
			.filter((filePath) => filePath.endsWith(`.tsx`))
			.map((filePath) => ({
				filePath,
				provider,
				relativePath: toPosixPath(path.relative(filesRoot, filePath)),
			}))
			.sort((left, right) =>
				left.relativePath.localeCompare(right.relativePath),
			)

		corpusFiles.push(...providerFiles)
	}

	return corpusFiles
}

async function analyzeCorpus(
	files: CorpusFile[],
	providers: CorpusProvider[],
	options: RunnerOptions,
): Promise<CorpusReport> {
	const startedAt = performance.now()
	const failures: CorpusFailure[] = []
	const fileReports: FileReport[] = []
	const opaqueReasons = new Map<string, number>()
	const patterns = new Map<string, number>()
	const warningCodes = new Map<string, number>()
	const providerReports = new Map<string, ProviderReport>()

	for (const provider of providers) {
		providerReports.set(provider.name, {
			durationMs: 0,
			failures: 0,
			fileCount: 0,
			name: provider.name,
			version: provider.version,
		})
	}

	for (const file of files) {
		const providerReport = providerReports.get(file.provider.name)
		if (providerReport) {
			providerReport.fileCount += 1
		}

		const fileReport = await analyzeFile(file, options)
		fileReports.push(fileReport)

		if (providerReport) {
			providerReport.durationMs += fileReport.durationMs
			if (fileReport.status === `failed`) {
				providerReport.failures += 1
			}
		}

		if (fileReport.status === `failed`) {
			failures.push({
				message: fileReport.error,
				provider: fileReport.provider,
				relativePath: fileReport.relativePath,
			})
			continue
		}

		for (const opaqueReason of fileReport.opaqueReasons) {
			incrementCount(opaqueReasons, opaqueReason.name, opaqueReason.count)
		}

		for (const pattern of fileReport.patterns) {
			incrementCount(patterns, pattern)
		}

		for (const warningCode of fileReport.warningCodes) {
			incrementCount(warningCodes, warningCode)
		}

		if (fileReport.durationMs > options.maxFileMs) {
			failures.push({
				message: `Exceeded per-file budget: ${formatMs(fileReport.durationMs)} > ${formatMs(
					options.maxFileMs,
				)}`,
				provider: fileReport.provider,
				relativePath: fileReport.relativePath,
			})
		}

		if (fileReport.synthetic.positiveFailures > 0) {
			failures.push({
				message: `Synthetic positive reachability failed for ${
					fileReport.synthetic.positiveFailures
				} selector(s).`,
				provider: fileReport.provider,
				relativePath: fileReport.relativePath,
			})
		}

		if (fileReport.synthetic.negativeReachableFailures > 0) {
			failures.push({
				message: `Synthetic negative reachability was reachable for ${
					fileReport.synthetic.negativeReachableFailures
				} selector(s).`,
				provider: fileReport.provider,
				relativePath: fileReport.relativePath,
			})
		}
	}

	const durationMs = performance.now() - startedAt

	if (files.length === 0) {
		failures.push({
			message: `No TSX corpus files were found.`,
			provider: `corpus`,
			relativePath: `.`,
		})
	}

	if (durationMs > options.maxTotalMs) {
		failures.push({
			message: `Exceeded total budget: ${formatMs(durationMs)} > ${formatMs(
				options.maxTotalMs,
			)}`,
			provider: `corpus`,
			relativePath: `.`,
		})
	}

	const okReports = fileReports.filter(isOkReport)
	const totals = {
		durationMs,
		elementCount: sum(okReports, (report) => report.stats.elementCount),
		failedFiles: fileReports.length - okReports.length,
		files: fileReports.length,
		opaqueCount: sum(okReports, (report) => report.stats.opaqueCount),
		providers: providers.length,
		syntheticNegativeReachableFailures: sum(
			okReports,
			(report) => report.synthetic.negativeReachableFailures,
		),
		syntheticPositiveFailures: sum(
			okReports,
			(report) => report.synthetic.positiveFailures,
		),
		warnings: sum(okReports, (report) => report.warningCodes.length),
	}

	return {
		files: fileReports,
		failures,
		generatedAt: new Date().toISOString(),
		opaqueReasons: countEntries(opaqueReasons),
		options: {
			maxFileMs: options.maxFileMs,
			maxTotalMs: options.maxTotalMs,
			providers: providers.map((provider) => provider.name),
			syntheticSelectorsPerFile: options.syntheticSelectorsPerFile,
		},
		providers: [...providerReports.values()],
		patterns: countEntries(patterns),
		schemaVersion: 1,
		slowestFiles: fileReports
			.toSorted((left, right) => right.durationMs - left.durationMs)
			.slice(0, 10)
			.map((report) => ({
				durationMs: report.durationMs,
				provider: report.provider,
				relativePath: report.relativePath,
			})),
		totals,
		warningCodes: countEntries(warningCodes),
	}
}

async function analyzeFile(
	file: CorpusFile,
	options: RunnerOptions,
): Promise<FileReport> {
	const sourceText = await readFile(file.filePath, `utf8`)
	const startedAt = performance.now()

	try {
		const renderStories = analyzeTsxRenderStories({
			filePath: file.filePath,
			sourceText,
		})
		const durationMs = performance.now() - startedAt
		const validationErrors = renderStories.flatMap((renderStory) =>
			validateRenderStory(renderStory, sourceText.length).map(
				(error) => `${renderStory.componentName}: ${error}`,
			),
		)
		const secondStories = analyzeTsxRenderStories({
			filePath: file.filePath,
			sourceText,
		})

		if (JSON.stringify(renderStories) !== JSON.stringify(secondStories)) {
			validationErrors.push(`Render story extraction is not deterministic.`)
		}

		const storyFacts = collectStoriesFacts(renderStories)
		const patterns = collectSourcePatterns(sourceText, file.filePath)
		const synthetic = runSyntheticReachabilityChecks(
			storyFacts.elementPaths,
			options.syntheticSelectorsPerFile,
		)

		if (validationErrors.length > 0) {
			return failedReport(
				file,
				durationMs,
				sourceText.length,
				validationErrors.join(` `),
			)
		}

		return {
			componentNames: renderStories.map(
				(renderStory) => renderStory.componentName,
			),
			durationMs,
			opaqueReasons: countEntries(storyFacts.opaqueReasons),
			patterns,
			provider: file.provider.name,
			relativePath: file.relativePath,
			sourceBytes: Buffer.byteLength(sourceText, `utf8`),
			stats: storyFacts.stats,
			status: `ok`,
			synthetic,
			warningCodes: renderStories.flatMap((renderStory) =>
				renderStory.warnings.map((warning) => warning.code),
			),
		}
	} catch (error) {
		return failedReport(
			file,
			performance.now() - startedAt,
			sourceText.length,
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		)
	}
}

function collectSourcePatterns(sourceText: string, filePath: string): string[] {
	const sourceFile = createTsxSourceFile(sourceText, filePath)
	const patterns = new Set<string>()

	function visit(node: ts.Node): void {
		if (ts.isJsxFragment(node)) {
			patterns.add(`fragment`)
		}

		if (ts.isJsxElement(node)) {
			const tagName = node.openingElement.tagName.getText(sourceFile)
			if (tagName === `Fragment` || tagName === `React.Fragment`) {
				patterns.add(`fragment`)
			}
		}

		if (ts.isJsxOpeningLikeElement(node)) {
			collectJsxOpeningPatterns(node, patterns)
		}

		if (ts.isJsxExpression(node) && node.expression) {
			if (isChildrenExpression(node.expression)) {
				patterns.add(`children`)
			}
		}

		if (ts.isConditionalExpression(node)) {
			patterns.add(`ternary`)
		}

		if (ts.isBinaryExpression(node)) {
			if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
				patterns.add(`logical-and`)
			}

			if (
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
				node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
			) {
				patterns.add(`fallback-expression`)
			}
		}

		if (ts.isArrayLiteralExpression(node)) {
			patterns.add(`array-render`)
		}

		if (ts.isReturnStatement(node)) {
			if (!node.expression) {
				patterns.add(`empty-return`)
			} else if (
				node.expression.kind === ts.SyntaxKind.NullKeyword ||
				node.expression.kind === ts.SyntaxKind.FalseKeyword
			) {
				patterns.add(`nullish-return`)
			}
		}

		if (ts.isCallExpression(node)) {
			collectCallPatterns(node, patterns)
		}

		node.forEachChild(visit)
	}

	visit(sourceFile)

	return [...patterns].sort((left, right) => left.localeCompare(right))
}

function collectJsxOpeningPatterns(
	node: ts.JsxOpeningLikeElement,
	patterns: Set<string>,
): void {
	if (ts.isPropertyAccessExpression(node.tagName)) {
		patterns.add(`member-jsx`)
	}

	for (const property of node.attributes.properties) {
		if (ts.isJsxSpreadAttribute(property)) {
			patterns.add(`jsx-spread`)
			continue
		}

		const attributeName = property.name.getText()

		if (attributeName === `as`) {
			patterns.add(`polymorphic-as`)
		}

		if (attributeName === `asChild`) {
			patterns.add(`as-child`)
		}

		if (
			property.initializer &&
			ts.isJsxExpression(property.initializer) &&
			property.initializer.expression &&
			isFunctionExpression(property.initializer.expression)
		) {
			patterns.add(`render-prop`)
		}
	}
}

function collectCallPatterns(
	node: ts.CallExpression,
	patterns: Set<string>,
): void {
	const callName = getCallName(node.expression)

	if (callName === `map`) {
		patterns.add(`map`)
	}

	if (callName === `cloneElement`) {
		patterns.add(`clone-element`)
	}

	if (callName === `createPortal`) {
		patterns.add(`portal`)
	}

	if (callName === `forwardRef`) {
		patterns.add(`forward-ref`)
	}

	if (callName === `memo`) {
		patterns.add(`memo`)
	}
}

function getCallName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) {
		return expression.text
	}

	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text
	}
}

function isFunctionExpression(
	expression: ts.Expression,
): expression is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
}

function isChildrenExpression(expression: ts.Expression): boolean {
	if (ts.isIdentifier(expression)) {
		return expression.text === `children`
	}

	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text === `children`
	}

	if (!ts.isElementAccessExpression(expression)) {
		return false
	}

	const argumentExpression = expression.argumentExpression

	return (
		ts.isStringLiteralLikeNode(argumentExpression) &&
		argumentExpression.text === `children`
	)
}

function failedReport(
	file: CorpusFile,
	durationMs: number,
	sourceBytes: number,
	error: string,
): FileFailedReport {
	return {
		durationMs,
		error,
		provider: file.provider.name,
		relativePath: file.relativePath,
		sourceBytes,
		status: `failed`,
	}
}

function validateRenderStory(
	renderStory: RenderStory,
	sourceLength: number,
): string[] {
	const errors: string[] = []

	if (!renderStory.componentName) {
		errors.push(`Render story has an empty componentName.`)
	}

	if (!Array.isArray(renderStory.roots)) {
		errors.push(`Render story roots is not an array.`)
	}

	for (const [rootIndex, root] of renderStory.roots.entries()) {
		validateStoryChild(root, sourceLength, `roots[${rootIndex}]`, errors)
	}

	for (const [warningIndex, warning] of renderStory.warnings.entries()) {
		if (!warning.code) {
			errors.push(`warnings[${warningIndex}] has an empty code.`)
		}

		if (!warning.message) {
			errors.push(`warnings[${warningIndex}] has an empty message.`)
		}

		validateRange(
			warning.range,
			sourceLength,
			`warnings[${warningIndex}].range`,
			errors,
		)
	}

	return errors
}

function validateStoryChild(
	child: StoryChild,
	sourceLength: number,
	label: string,
	errors: string[],
): void {
	if (child.kind === `element`) {
		validateElement(child, sourceLength, label, errors)
		return
	}
	if (child.kind === `choice`) {
		validateRange(child.range, sourceLength, `${label}.range`, errors)
		for (const [
			alternativeIndex,
			alternative,
		] of child.alternatives.entries()) {
			for (const [childIndex, alternativeChild] of alternative.entries()) {
				validateStoryChild(
					alternativeChild,
					sourceLength,
					`${label}.alternatives[${alternativeIndex}][${childIndex}]`,
					errors,
				)
			}
		}
		return
	}

	validateOpaque(child, sourceLength, label, errors)
}

function validateElement(
	node: StoryNode,
	sourceLength: number,
	label: string,
	errors: string[],
): void {
	if (!node.tagName) {
		errors.push(`${label} has an empty tagName.`)
	}

	if (!Array.isArray(node.children)) {
		errors.push(`${label}.children is not an array.`)
		return
	}

	validateRange(node.range, sourceLength, `${label}.range`, errors)

	for (const [childIndex, child] of node.children.entries()) {
		validateStoryChild(
			child,
			sourceLength,
			`${label}.children[${childIndex}]`,
			errors,
		)
	}
}

function validateOpaque(
	node: OpaqueStoryNode,
	sourceLength: number,
	label: string,
	errors: string[],
): void {
	if (!node.reason) {
		errors.push(`${label} has an empty opaque reason.`)
	}

	validateRange(node.range, sourceLength, `${label}.range`, errors)
}

function validateRange(
	range: SourceRange | undefined,
	sourceLength: number,
	label: string,
	errors: string[],
): void {
	if (!range) return

	if (
		!Number.isInteger(range.start) ||
		!Number.isInteger(range.end) ||
		range.start < 0 ||
		range.end < range.start ||
		range.end > sourceLength
	) {
		errors.push(
			`${label} is outside source bounds: ${range.start}-${range.end} / ${sourceLength}.`,
		)
	}
}

function collectStoriesFacts(renderStories: RenderStory[]): {
	elementPaths: ElementPath[]
	opaqueReasons: Map<string, number>
	stats: StoryStats
} {
	const elementPaths: ElementPath[] = []
	const opaqueReasons = new Map<string, number>()
	const stats: StoryStats = {
		elementCount: 0,
		maxDepth: 0,
		opaqueCount: 0,
		rootCount: sum(renderStories, (renderStory) => renderStory.roots.length),
	}

	for (const renderStory of renderStories) {
		for (const root of renderStory.roots) {
			collectChildFacts(
				renderStory,
				root,
				1,
				[],
				elementPaths,
				opaqueReasons,
				stats,
			)
		}
	}

	return { elementPaths, opaqueReasons, stats }
}

function collectChildFacts(
	renderStory: RenderStory,
	child: StoryChild,
	depth: number,
	parentPath: SelectorPath,
	elementPaths: ElementPath[],
	opaqueReasons: Map<string, number>,
	stats: StoryStats,
): void {
	if (child.kind === `opaque`) {
		stats.opaqueCount += 1
		incrementCount(opaqueReasons, child.reason)
		return
	}
	if (child.kind === `choice`) {
		for (const alternative of child.alternatives) {
			for (const alternativeChild of alternative) {
				collectChildFacts(
					renderStory,
					alternativeChild,
					depth,
					parentPath,
					elementPaths,
					opaqueReasons,
					stats,
				)
			}
		}
		return
	}

	stats.elementCount += 1
	stats.maxDepth = Math.max(stats.maxDepth, depth)

	const pathSegment = {
		relation: parentPath.length === 0 ? (`self` as const) : (`child` as const),
		tagName: child.tagName,
	}
	const currentPath = [...parentPath, pathSegment]
	elementPaths.push({ path: currentPath, story: renderStory })

	for (const nestedChild of child.children) {
		collectChildFacts(
			renderStory,
			nestedChild,
			depth + 1,
			currentPath,
			elementPaths,
			opaqueReasons,
			stats,
		)
	}
}

function runSyntheticReachabilityChecks(
	elementPaths: ElementPath[],
	maxSelectors: number,
): SyntheticStats {
	const selectedPaths = elementPaths.slice(0, maxSelectors)
	const syntheticStats: SyntheticStats = {
		negativeReachableFailures: 0,
		negativeUnknown: 0,
		positiveFailures: 0,
		selectorsChecked: selectedPaths.length * 2,
	}

	for (const { path: pathToElement, story } of selectedPaths) {
		if (canReachSelectorPath(story, pathToElement) !== `reachable`) {
			syntheticStats.positiveFailures += 1
		}

		const negativePath = createNegativePath(pathToElement)
		if (!negativePath) continue

		const negativeReachability = canReachSelectorPath(story, negativePath)

		if (negativeReachability === `reachable`) {
			syntheticStats.negativeReachableFailures += 1
		}

		if (negativeReachability === `unknown`) {
			syntheticStats.negativeUnknown += 1
		}
	}

	return syntheticStats
}

function createNegativePath(
	pathToElement: SelectorPath,
): SelectorPath | undefined {
	const lastSegment = pathToElement.at(-1)

	if (!lastSegment) return

	return [
		...pathToElement.slice(0, -1),
		{
			...lastSegment,
			tagName: `${lastSegment.tagName}-lasertag-missing`,
		},
	]
}

async function writeReports(
	report: CorpusReport,
	options: RunnerOptions,
): Promise<void> {
	await mkdir(path.dirname(options.jsonPath), { recursive: true })
	await mkdir(path.dirname(options.markdownPath), { recursive: true })
	await writeFile(options.jsonPath, `${JSON.stringify(report, null, `\t`)}\n`)
	await writeFile(options.markdownPath, renderMarkdownReport(report))
}

function renderMarkdownReport(report: CorpusReport): string {
	const lines: string[] = [
		`# Refractor Corpus Report`,
		``,
		`Generated: ${report.generatedAt}`,
		``,
		`## Summary`,
		``,
		`| Metric | Value |`,
		`| --- | ---: |`,
		`| Providers | ${report.totals.providers} |`,
		`| Files | ${report.totals.files} |`,
		`| Failed files | ${report.totals.failedFiles} |`,
		`| Failures | ${report.failures.length} |`,
		`| Elements | ${report.totals.elementCount} |`,
		`| Opaque branches | ${report.totals.opaqueCount} |`,
		`| Warnings | ${report.totals.warnings} |`,
		`| Duration | ${formatMs(report.totals.durationMs)} |`,
		``,
		`## Providers`,
		``,
		`| Provider | Version | Files | Failures | Duration |`,
		`| --- | --- | ---: | ---: | ---: |`,
		...report.providers.map(
			(provider) =>
				`| ${provider.name} | ${provider.version} | ${provider.fileCount} | ${provider.failures} | ${formatMs(
					provider.durationMs,
				)} |`,
		),
		``,
		`## Failures`,
		``,
		...markdownFailures(report.failures),
		``,
		`## Opaque Reasons`,
		``,
		...markdownCounts(report.opaqueReasons),
		``,
		`## Pattern Coverage`,
		``,
		...markdownCounts(report.patterns),
		``,
		`## Warning Codes`,
		``,
		...markdownCounts(report.warningCodes),
		``,
		`## Slowest Files`,
		``,
		`| File | Duration |`,
		`| --- | ---: |`,
		...report.slowestFiles.map(
			(file) =>
				`| ${file.provider}/${file.relativePath} | ${formatMs(
					file.durationMs,
				)} |`,
		),
		``,
	]

	return `${lines.join(`\n`)}\n`
}

function markdownFailures(failures: CorpusFailure[]): string[] {
	if (failures.length === 0) return [`No failures.`]

	return failures.map(
		(failure) =>
			`- \`${failure.provider}/${failure.relativePath}\`: ${failure.message}`,
	)
}

function markdownCounts(counts: CountEntry[]): string[] {
	if (counts.length === 0) return [`No entries.`]

	return [
		`| Name | Count |`,
		`| --- | ---: |`,
		...counts.map((entry) => `| ${entry.name} | ${entry.count} |`),
	]
}

function printSummary(report: CorpusReport, options: RunnerOptions): void {
	console.log(
		`Analyzed ${report.totals.files} file(s) from ${
			report.totals.providers
		} provider(s) in ${formatMs(report.totals.durationMs)}.`,
	)
	console.log(
		`Found ${report.totals.elementCount} element(s), ${
			report.totals.opaqueCount
		} opaque branch(es), and ${report.failures.length} failure(s).`,
	)

	if (options.report) {
		console.log(`Wrote ${options.jsonPath}`)
		console.log(`Wrote ${options.markdownPath}`)
	}

	for (const failure of report.failures.slice(0, 10)) {
		console.error(
			`FAIL ${failure.provider}/${failure.relativePath}: ${failure.message}`,
		)
	}

	if (report.failures.length > 10) {
		console.error(`... ${report.failures.length - 10} more failure(s)`)
	}
}

async function listFiles(directoryPath: string): Promise<string[]> {
	let directoryEntries: Dirent[]

	try {
		directoryEntries = await readdir(directoryPath, { withFileTypes: true })
	} catch (error) {
		if (isNodeError(error) && error.code === `ENOENT`) {
			return []
		}

		throw error
	}

	const nestedFiles = await Promise.all(
		directoryEntries.map(async (entry) => {
			const entryPath = path.join(directoryPath, entry.name)

			if (entry.isDirectory()) {
				return listFiles(entryPath)
			}

			return entry.isFile() ? [entryPath] : []
		}),
	)

	return nestedFiles.flat()
}

function countEntries(counts: Map<string, number>): CountEntry[] {
	return [...counts]
		.map(([name, count]) => ({ count, name }))
		.toSorted((left, right) => right.count - left.count)
}

function incrementCount(
	counts: Map<string, number>,
	name: string,
	amount = 1,
): void {
	counts.set(name, (counts.get(name) ?? 0) + amount)
}

function isOkReport(report: FileReport): report is FileOkReport {
	return report.status === `ok`
}

function sum<T>(items: T[], getValue: (item: T) => number): number {
	return items.reduce((total, item) => total + getValue(item), 0)
}

function formatMs(durationMs: number): string {
	return `${durationMs.toFixed(1)}ms`
}

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join(`/`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && `code` in error
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
