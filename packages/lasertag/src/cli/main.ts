#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { isMainThread, workerData } from "node:worker_threads"

import {
	cli,
	help,
	noOptions,
	options,
	optional,
	parseBooleanOption,
	parseStringOption,
} from "comline"
import { Logger } from "takua"
import { globSync } from "tinyglobby"
import { z } from "zod/v4"

import {
	createTypescriptAstSession,
	type CssReachabilityDiagnostic,
} from "../refractor/index.ts"
import {
	processLasertagCheckTask,
	runLasertagCheck,
	type LasertagCheckFileSystem,
} from "./check.ts"
import {
	processLasertagFixTask,
	runLasertagFix,
	type LasertagFixFileSystem,
	type LasertagFixProgress,
	type LasertagFixResult,
} from "./fix.ts"
import {
	buildLasertagVsix,
	defaultLasertagPackageRoot,
	installVscodeExtensionWithEditor,
	type LasertagVscodeInstallRequest,
	type LasertagVscodeInstallResult,
	type LasertagVsixBuildOptions,
	type LasertagVsixBuildResult,
} from "./vsix.ts"
import { isLasertagWorkerData, runLasertagWorker } from "./work-stealing.ts"

const DEFAULT_TARGET_PATTERNS = [`**/*.module.css`]
const DEFAULT_IGNORE_PATTERNS = [
	`**/node_modules/**`,
	`**/dist/**`,
	`**/build/**`,
	`**/coverage/**`,
	`**/tests/refractor/corpus/providers/**`,
]
const FORMAT_OPTIONS = [`stylish`, `json`] as const

const rootOptionsSchema = z.object({
	help: z.boolean().default(false),
	version: z.boolean().default(false),
})

const checkOptionsSchema = z.object({
	format: z.enum(FORMAT_OPTIONS).default(`stylish`),
})

const vsixOptionsSchema = z.object({
	"build-only": z.boolean().default(false),
	outdir: z.string().optional(),
	target: z.string().default(`code`),
})

type RootOptions = z.infer<typeof rootOptionsSchema>
type CheckOptions = z.infer<typeof checkOptionsSchema>
type FixOptions = Record<never, never>
type VsixOptions = z.infer<typeof vsixOptionsSchema>
type LasertagOutputFormat = CheckOptions[`format`]

export type LasertagCliMode = `check` | `fix` | `help` | `version` | `vsix`

export type LasertagCliDiagnostic = CssReachabilityDiagnostic & {
	cssPath: string
	line: number
	column: number
	tsxPath: string
}

export type LasertagCliOptions =
	| CheckOptions
	| FixOptions
	| RootOptions
	| VsixOptions

export type LasertagCliResult = {
	changedFiles?: string[]
	diagnostics: LasertagCliDiagnostic[]
	exitCode: number
	files: string[]
	fixedCount?: number
	mode: LasertagCliMode
	options: LasertagCliOptions
	stealCount?: number
	targets: string[]
	vsix?: LasertagVsixBuildResult & { editorCommand: string }
	workerCount?: number
}

export type LasertagCliIO = {
	error: (message: string, ...data: unknown[]) => void
	log: (message: string, ...data: unknown[]) => void
}

export type LasertagCliEnvironment = {
	buildVsix?: (
		options: LasertagVsixBuildOptions,
	) => Promise<LasertagVsixBuildResult>
	checkWorkerCount?: number
	cwd?: string
	fileExists?: (filePath: string) => boolean
	fixWorkerCount?: number
	glob?: typeof globSync
	installVscodeExtension?: (
		request: LasertagVscodeInstallRequest,
	) => Promise<LasertagVscodeInstallResult> | LasertagVscodeInstallResult
	packageRoot?: string
	packageVersion?: string
	readFile?: (filePath: string) => string
	typescriptSdkPath?: string
	writeFile?: (filePath: string, sourceText: string) => void
}

const lasertagRoutes = optional({
	check: optional({
		$glob: null,
	}),
	fix: optional({
		$glob: null,
	}),
	vsix: null,
})

const checkRouteOptions = options(
	`Validate component-owned CSS modules.`,
	checkOptionsSchema,
	{
		format: {
			description: `output format`,
			flag: `f`,
			example: `--format json`,
			required: false,
		},
	},
)

const fixRouteOptions = noOptions(
	`Remove dead CSS from component-owned CSS modules.`,
)

const lasertagCli = cli({
	cliName: `lasertag`,
	cliDescription: `Validate and fix Lasertag CSS modules or build the workspace VSCode extension.`,
	discoverConfigPath: () => undefined,
	routes: lasertagRoutes,
	routeOptions: {
		"": options(`Show Lasertag command help.`, rootOptionsSchema, {
			help: {
				description: `show this help text`,
				example: `--help`,
				flag: `h`,
				parse: parseBooleanOption,
				required: false,
			},
			version: {
				description: `print the Lasertag CLI version`,
				example: `--version`,
				flag: `v`,
				parse: parseBooleanOption,
				required: false,
			},
		}),
		check: checkRouteOptions,
		"check/$glob": checkRouteOptions,
		fix: fixRouteOptions,
		"fix/$glob": fixRouteOptions,
		vsix: options(
			`Build and install the current-platform VSCode extension.`,
			vsixOptionsSchema,
			{
				"build-only": {
					description: `build the VSIX without installing it`,
					example: `--build-only`,
					parse: parseBooleanOption,
					required: false,
				},
				outdir: {
					description: `directory for the generated VSIX`,
					example: `--outdir dist`,
					flag: `o`,
					parse: parseStringOption,
					required: false,
				},
				target: {
					description: `editor command used to install the VSIX`,
					example: `--target code-insiders`,
					flag: `t`,
					parse: parseStringOption,
					required: false,
				},
			},
		),
	},
})

function isCssModulePath(filePath: string): boolean {
	return filePath.endsWith(`.module.css`)
}

function resolvePath(cwd: string, filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
}

function discoverCssModuleFiles(
	targets: string[],
	environment: LasertagCliEnvironment,
): string[] {
	const cwd = environment.cwd ?? process.cwd()
	const fileExists = environment.fileExists ?? existsSync
	const glob = environment.glob ?? globSync
	const directFiles = targets
		.map((target) => resolvePath(cwd, target))
		.filter(
			(targetPath) => fileExists(targetPath) && isCssModulePath(targetPath),
		)
	const globTargets = targets.filter(
		(target) => !fileExists(resolvePath(cwd, target)),
	)
	const globFiles =
		globTargets.length === 0
			? []
			: glob(globTargets, {
					absolute: true,
					cwd,
					ignore: DEFAULT_IGNORE_PATTERNS,
					onlyFiles: true,
				}).filter(isCssModulePath)

	return [...new Set([...directFiles, ...globFiles])].toSorted()
}

function offsetToLineColumn(sourceText: string, offset: number) {
	let line = 1
	let column = 1

	for (let index = 0; index < offset; index += 1) {
		if (sourceText[index] === `\n`) {
			line += 1
			column = 1
			continue
		}

		column += 1
	}

	return { column, line }
}

type WarningRegionLine = {
	highlightEnd: number
	highlightStart: number
	line: number
	text: string
}

const MAX_WARNING_REGION_LINES = 2

function warningRegionLines(
	sourceText: string,
	startOffset: number,
	endOffset: number,
): WarningRegionLine[] {
	const start = Math.min(Math.max(startOffset, 0), sourceText.length)
	const end = Math.min(Math.max(endOffset, start + 1), sourceText.length)
	const lastSelectedOffset = Math.max(end - 1, start)
	const firstLineStart = sourceText.lastIndexOf(`\n`, start - 1) + 1
	let line = offsetToLineColumn(sourceText, firstLineStart).line
	let lineStart = firstLineStart
	const lines: WarningRegionLine[] = []

	while (lineStart <= lastSelectedOffset && lineStart < sourceText.length) {
		const newline = sourceText.indexOf(`\n`, lineStart)
		const lineEnd = newline === -1 ? sourceText.length : newline
		const text = sourceText.slice(lineStart, lineEnd).replace(/\r$/, ``)
		const highlightStart = Math.max(start - lineStart, 0)
		const highlightEnd = Math.min(
			Math.max(end - lineStart, highlightStart + 1),
			text.length,
		)

		lines.push({ highlightEnd, highlightStart, line, text })

		if (lineEnd > lastSelectedOffset || newline === -1) break

		line += 1
		lineStart = newline + 1
	}

	return lines
}

function expandTabs(text: string): string {
	return text.replaceAll(`\t`, `    `)
}

function formatWarningRegion(
	diagnostic: LasertagCliDiagnostic,
	sourceText: string,
): string | undefined {
	if (!diagnostic.range) return

	const lines = warningRegionLines(
		sourceText,
		diagnostic.range.start,
		diagnostic.range.end,
	)

	if (lines.length === 0) return

	const visibleLines =
		lines.length <= MAX_WARNING_REGION_LINES
			? lines
			: [lines[0], undefined, lines.at(-1)]
	const lineNumberWidth = String(lines.at(-1)?.line ?? diagnostic.line).length
	const output: string[] = []

	for (const line of visibleLines) {
		if (!line) {
			output.push(`${` `.repeat(lineNumberWidth)} │ …`)
			continue
		}

		const expandedText = expandTabs(line.text).trimEnd()
		const caretStart = expandTabs(
			line.text.slice(0, line.highlightStart),
		).length
		const caretWidth = Math.max(
			expandTabs(line.text.slice(line.highlightStart, line.highlightEnd))
				.length,
			1,
		)

		output.push(
			`${String(line.line).padStart(lineNumberWidth)} │ ${expandedText}`,
			`${` `.repeat(lineNumberWidth)} │ ${` `.repeat(caretStart)}${`^`.repeat(caretWidth)}`,
		)
	}

	return output.join(`\n`)
}

function formatStylishDiagnostic(
	diagnostic: LasertagCliDiagnostic,
	cwd: string,
	cssSource?: string,
): string {
	const relativeCssPath = path.relative(cwd, diagnostic.cssPath)
	const displayCssPath =
		relativeCssPath && !relativeCssPath.startsWith(`..`)
			? relativeCssPath
			: diagnostic.cssPath

	const message = [
		`${displayCssPath}:${diagnostic.line}:${diagnostic.column}`,
		diagnostic.code,
		diagnostic.message,
	].join(` `)
	const region = cssSource
		? formatWarningRegion(diagnostic, cssSource)
		: undefined

	return region ? `${message}\n${region}` : message
}

function formatDiagnostics(
	diagnostics: LasertagCliDiagnostic[],
	format: LasertagOutputFormat,
	files: string[],
	cwd: string,
	readCssSource: (cssPath: string) => string,
): string {
	if (format === `json`) {
		return JSON.stringify({ diagnostics, files }, null, 2)
	}

	if (diagnostics.length === 0) {
		const noun = files.length === 1 ? `file` : `files`

		return `lasertag check: no dead CSS found in ${files.length} ${noun}.`
	}

	return diagnostics
		.map((diagnostic) =>
			formatStylishDiagnostic(
				diagnostic,
				cwd,
				readCssSource(diagnostic.cssPath),
			),
		)
		.join(`\n\n`)
}

function createDiagnostic(
	diagnostic: CssReachabilityDiagnostic,
	cssPath: string,
	cssSource: string,
	tsxPath: string,
): LasertagCliDiagnostic {
	const position = offsetToLineColumn(cssSource, diagnostic.range?.start ?? 0)

	return {
		...diagnostic,
		column: position.column,
		cssPath,
		line: position.line,
		tsxPath,
	}
}

async function runCheck(
	targets: string[],
	options: CheckOptions,
	io: LasertagCliIO,
	environment: LasertagCliEnvironment,
): Promise<LasertagCliResult> {
	const cwd = environment.cwd ?? process.cwd()
	const files = discoverCssModuleFiles(targets, environment)
	const fileSystem = checkFileSystemFromEnvironment(environment)
	const checkResult = await runLasertagCheck(files, {
		...(environment.checkWorkerCount
			? { workerCount: environment.checkWorkerCount }
			: {}),
		...(fileSystem ? { fileSystem } : {}),
		...(environment.typescriptSdkPath
			? { typescriptSdkPath: environment.typescriptSdkPath }
			: {}),
		workerModuleUrl: new URL(import.meta.url),
	})
	const readFile =
		environment.readFile ??
		((filePath: string) => readFileSync(filePath, `utf-8`))
	const cssSources = new Map<string, string>()
	const readCssSource = (cssPath: string) => {
		const cachedSource = cssSources.get(cssPath)

		if (cachedSource !== undefined) return cachedSource

		const sourceText = readFile(cssPath)

		cssSources.set(cssPath, sourceText)
		return sourceText
	}
	const diagnostics = checkResult.diagnostics.map(
		({ cssPath, diagnostic, tsxPath }) =>
			createDiagnostic(diagnostic, cssPath, readCssSource(cssPath), tsxPath),
	)

	for (const failure of checkResult.failures) {
		io.error(
			`lasertag check: ${displayPath(cwd, failure.cssPath)}: ${failure.error ?? `unknown failure`}`,
		)
	}

	io.log(
		formatDiagnostics(diagnostics, options.format, files, cwd, readCssSource),
	)

	return {
		diagnostics,
		exitCode: checkResult.failures.length > 0 || diagnostics.length > 0 ? 1 : 0,
		files,
		mode: `check`,
		options,
		stealCount: checkResult.stealCount,
		targets,
		workerCount: checkResult.workerCount,
	}
}

function createCliLogger(io: LasertagCliIO): Logger {
	return new Logger({
		colorEnabled: false,
		sink: {
			error: (message) => io.error(message),
			info: (message) => io.log(message),
			log: (message) => io.log(message),
			warn: (message) => io.error(message),
		},
	})
}

const MAX_FIX_CHRONICLE_EVENT_LENGTH = 64

function abbreviate(text: string, maximumLength: number): string {
	if (text.length <= maximumLength) return text
	if (maximumLength <= 1) return `…`

	return `${text.slice(0, maximumLength - 1)}…`
}

function fixProgressMark({
	completed,
	file,
	total,
}: LasertagFixProgress): string {
	const outcome = (() => {
		switch (file.status) {
			case `changed`:
				return `removed ${file.fixedCount} ${plural(file.fixedCount, `selector`)}`
			case `failed`:
				return `FAILED`
			case `skipped`:
				return `skipped no TSX`
			case `unchanged`:
				return file.remainingDiagnostics.length > 0
					? `${file.remainingDiagnostics.length} unresolved`
					: `clean`
		}
	})()
	const worker = file.workerId + 1
	const assignment =
		file.stolenFrom === undefined
			? ` [w${worker}]`
			: ` [w${worker} stole w${file.stolenFrom + 1}]`
	const prefix = `fix ${completed}/${total} ${outcome} `
	const name = path.basename(file.cssPath, `.module.css`)
	const nameBudget = Math.max(
		MAX_FIX_CHRONICLE_EVENT_LENGTH - prefix.length - assignment.length,
		1,
	)

	return `${prefix}${abbreviate(name, nameBudget)}${assignment}`.slice(
		0,
		MAX_FIX_CHRONICLE_EVENT_LENGTH,
	)
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
	return count === 1 ? singular : pluralForm
}

function displayPath(cwd: string, filePath: string): string {
	const relativePath = path.relative(cwd, filePath)

	return relativePath && !relativePath.startsWith(`..`)
		? relativePath
		: filePath
}

function checkFileSystemFromEnvironment(
	environment: LasertagCliEnvironment,
): Partial<LasertagCheckFileSystem> | undefined {
	const fileSystem: Partial<LasertagCheckFileSystem> = {
		...(environment.fileExists ? { fileExists: environment.fileExists } : {}),
		...(environment.readFile ? { readFile: environment.readFile } : {}),
	}

	return Object.keys(fileSystem).length > 0 ? fileSystem : undefined
}

function fixFileSystemFromEnvironment(
	environment: LasertagCliEnvironment,
): Partial<LasertagFixFileSystem> | undefined {
	const fileSystem: Partial<LasertagFixFileSystem> = {
		...(environment.fileExists ? { fileExists: environment.fileExists } : {}),
		...(environment.readFile ? { readFile: environment.readFile } : {}),
		...(environment.writeFile ? { writeFile: environment.writeFile } : {}),
	}

	return Object.keys(fileSystem).length > 0 ? fileSystem : undefined
}

async function runFix(
	targets: string[],
	io: LasertagCliIO,
	environment: LasertagCliEnvironment,
): Promise<LasertagCliResult> {
	const cwd = environment.cwd ?? process.cwd()
	const chronicle = createCliLogger(io).makeChronicle({ inline: true })

	chronicle.mark(`fix started`)

	const files = discoverCssModuleFiles(targets, environment)
	const progressInterval = Math.max(1, Math.ceil(files.length / 100))
	const fileSystem = fixFileSystemFromEnvironment(environment)

	chronicle.mark(`fix discovered ${files.length} CSS modules`)

	let fixResult: LasertagFixResult

	try {
		fixResult = await runLasertagFix(files, {
			...(environment.fixWorkerCount
				? { workerCount: environment.fixWorkerCount }
				: {}),
			...(fileSystem ? { fileSystem } : {}),
			onProgress: (progress) => {
				const { completed, total } = progress

				if (completed === total || completed % progressInterval === 0) {
					chronicle.mark(fixProgressMark(progress))
				}
			},
			onStart: ({ workerCount }) => {
				chronicle.mark(
					workerCount === 0
						? `fix no workers needed`
						: workerCount === 1
							? `fix started 1 worker`
							: `fix started ${workerCount} workers`,
				)
			},
			...(environment.typescriptSdkPath
				? { typescriptSdkPath: environment.typescriptSdkPath }
				: {}),
			workerModuleUrl: new URL(import.meta.url),
		})
	} catch (error) {
		chronicle.mark(`fix failed`)
		chronicle.logMarks()
		throw error
	}

	chronicle.mark(
		fixResult.workerCount === 0
			? `fix finished: no files`
			: `fix workers finished: ${fixResult.workerCount} ${plural(fixResult.workerCount, `worker`)}, ${fixResult.stealCount} ${plural(fixResult.stealCount, `steal`)}`,
	)
	chronicle.logMarks()

	for (const failure of fixResult.failures) {
		io.error(
			`lasertag fix: ${displayPath(cwd, failure.cssPath)}: ${failure.error ?? `unknown failure`}`,
		)
	}

	const readFile =
		environment.readFile ??
		((filePath: string) => readFileSync(filePath, `utf-8`))
	const diagnostics = fixResult.remainingDiagnostics.map(
		({ cssPath, diagnostic, tsxPath }) =>
			createDiagnostic(diagnostic, cssPath, readFile(cssPath), tsxPath),
	)

	for (const diagnostic of diagnostics) {
		io.error(formatStylishDiagnostic(diagnostic, cwd))
	}

	if (
		fixResult.fixedCount === 0 &&
		fixResult.failures.length === 0 &&
		diagnostics.length === 0
	) {
		io.log(
			`lasertag fix: no dead CSS found in ${files.length} ${plural(files.length, `file`)}.`,
		)
	} else {
		io.log(
			`lasertag fix: removed ${fixResult.fixedCount} dead ${plural(fixResult.fixedCount, `selector`)} from ${fixResult.changedFiles.length} ${plural(fixResult.changedFiles.length, `file`)}.`,
		)
	}

	return {
		changedFiles: fixResult.changedFiles,
		diagnostics,
		exitCode: fixResult.failures.length > 0 || diagnostics.length > 0 ? 1 : 0,
		files,
		fixedCount: fixResult.fixedCount,
		mode: `fix`,
		options: {},
		stealCount: fixResult.stealCount,
		targets,
		workerCount: fixResult.workerCount,
	}
}

function readPackageVersion(environment: LasertagCliEnvironment): string {
	if (environment.packageVersion) return environment.packageVersion

	const packageRoot = environment.packageRoot ?? defaultLasertagPackageRoot()
	const packageJson = JSON.parse(
		readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
	) as { version?: string }

	return packageJson.version ?? `0.0.0`
}

async function runVsix(
	options: VsixOptions,
	io: LasertagCliIO,
	environment: LasertagCliEnvironment,
): Promise<LasertagCliResult> {
	const cwd = environment.cwd ?? process.cwd()
	const packageRoot = environment.packageRoot ?? defaultLasertagPackageRoot()
	const outdir = path.resolve(cwd, options.outdir ?? `dist`)
	const build = environment.buildVsix ?? buildLasertagVsix
	const install =
		environment.installVscodeExtension ?? installVscodeExtensionWithEditor
	const vsix = await build({ outdir, packageRoot })

	if (options[`build-only`]) {
		io.log(`lasertag vsix: built ${vsix.vsixPath}.`)

		return {
			diagnostics: [],
			exitCode: 0,
			files: [],
			mode: `vsix`,
			options,
			targets: [],
			vsix: {
				...vsix,
				editorCommand: options.target,
			},
		}
	}

	const installResult = await install({
		cwd,
		editorCommand: options.target,
		vsixPath: vsix.vsixPath,
	})

	if (installResult.error) {
		io.error(`lasertag vsix: ${installResult.error}`)
	} else if (installResult.exitCode !== 0) {
		io.error(
			`lasertag vsix: ${options.target} exited with code ${installResult.exitCode}.`,
		)
	} else {
		io.log(`lasertag vsix: installed ${vsix.vsixPath} with ${options.target}.`)
	}

	return {
		diagnostics: [],
		exitCode: installResult.exitCode,
		files: [],
		mode: `vsix`,
		options,
		targets: [],
		vsix: {
			...vsix,
			editorCommand: options.target,
		},
	}
}

function targetsFromGlob(glob: string | undefined): string[] {
	const targets =
		glob
			?.split(`,`)
			.map((target) => target.trim())
			.filter((target) => target.length > 0) ?? []

	return targets.length > 0 ? targets : DEFAULT_TARGET_PATTERNS
}

export async function runLasertagCli(
	args: string[] = process.argv,
	io: LasertagCliIO = console,
	environment: LasertagCliEnvironment = {},
): Promise<LasertagCliResult> {
	const parsed = lasertagCli(args)

	switch (parsed.inputs.case) {
		case ``: {
			const rootOptions = parsed.inputs.opts

			if (rootOptions.help) {
				io.log(help(lasertagCli.definition))
				return {
					diagnostics: [],
					exitCode: 0,
					files: [],
					mode: `help`,
					options: rootOptions,
					targets: [],
				}
			}

			if (rootOptions.version) {
				const version = readPackageVersion(environment)
				io.log(version)
				return {
					diagnostics: [],
					exitCode: 0,
					files: [],
					mode: `version`,
					options: rootOptions,
					targets: [],
				}
			}

			io.log(help(lasertagCli.definition))
			return {
				diagnostics: [],
				exitCode: 0,
				files: [],
				mode: `help`,
				options: rootOptions,
				targets: [],
			}
		}
		case `fix`:
			return runFix(DEFAULT_TARGET_PATTERNS, io, environment)
		case `fix/$glob`:
			return runFix(targetsFromGlob(parsed.inputs.path[1]), io, environment)
		case `check`:
			return runCheck(
				DEFAULT_TARGET_PATTERNS,
				parsed.inputs.opts,
				io,
				environment,
			)
		case `check/$glob`:
			return runCheck(
				targetsFromGlob(parsed.inputs.path[1]),
				parsed.inputs.opts,
				io,
				environment,
			)
		case `vsix`:
			return runVsix(parsed.inputs.opts, io, environment)
	}
}

if (!isMainThread && isLasertagWorkerData(workerData)) {
	const typescriptSession = createTypescriptAstSession(
		workerData.typescriptSdkPath
			? { typescriptSdkPath: workerData.typescriptSdkPath }
			: {},
	)

	try {
		await runLasertagWorker(workerData, (task, workerId) => {
			switch (task.operation) {
				case `check`:
					return processLasertagCheckTask(task, workerId, typescriptSession)
				case `fix`:
					return processLasertagFixTask(task, workerId, typescriptSession)
			}
		})
	} finally {
		typescriptSession.close()
	}
} else if (isMainThread && import.meta.main) {
	try {
		const result = await runLasertagCli()
		process.exitCode = result.exitCode
	} catch (error) {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	}
}
