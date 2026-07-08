#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
	cli,
	help,
	options,
	parseBooleanOption,
	parseStringOption,
} from "comline"
import { globSync } from "tinyglobby"
import { z } from "zod/v4"

import {
	validateCssReachability,
	type CssReachabilityDiagnostic,
} from "../../refractor/src/index.ts"

const DEFAULT_TARGET_PATTERNS = [`**/*.module.css`]
const DEFAULT_IGNORE_PATTERNS = [
	`**/node_modules/**`,
	`**/dist/**`,
	`**/build/**`,
	`**/coverage/**`,
	`**/refractor/corpus/providers/**`,
]
const FORMAT_OPTIONS = [`stylish`, `json`] as const

const lasertagOptionsSchema = z.object({
	fix: z.boolean().default(false),
	format: z.enum(FORMAT_OPTIONS).default(`stylish`),
	help: z.boolean().default(false),
	"vscode-install": z.string().optional(),
})

type LasertagOptions = z.infer<typeof lasertagOptionsSchema>
type LasertagOutputFormat = LasertagOptions[`format`]

export type LasertagCliMode = `fix` | `help` | `validate` | `vscode-install`

export type LasertagCliDiagnostic = CssReachabilityDiagnostic & {
	cssPath: string
	line: number
	column: number
	tsxPath: string
}

export type LasertagCliResult = {
	diagnostics: LasertagCliDiagnostic[]
	exitCode: number
	files: string[]
	mode: LasertagCliMode
	options: LasertagOptions
	targets: string[]
}

export type LasertagCliIO = {
	error: (message: string, ...data: unknown[]) => void
	log: (message: string, ...data: unknown[]) => void
}

export type LasertagVscodeInstallRequest = {
	cwd: string
	editorCommand: string
	vsixPath: string
}

export type LasertagVscodeInstallResult = {
	error?: string
	exitCode: number
}

export type LasertagCliEnvironment = {
	cwd?: string
	fileExists?: (filePath: string) => boolean
	glob?: typeof globSync
	installVscodeExtension?: (
		request: LasertagVscodeInstallRequest,
	) => LasertagVscodeInstallResult
	readFile?: (filePath: string) => string
	vsixPath?: string
}

const lasertagCli = cli({
	cliName: `lasertag`,
	cliDescription: `Validate lasertag CSS modules against component render stories. Pass an optional quoted glob such as "src/**/*.module.css".`,
	discoverConfigPath: () => undefined,
	routeOptions: {
		"": options(
			`Validate component-owned CSS modules. Use --fix to remove dead CSS when implemented.`,
			lasertagOptionsSchema,
			{
				fix: {
					description: `remove dead CSS when implemented`,
					example: `--fix`,
					flag: `f`,
					parse: parseBooleanOption,
					required: false,
				},
				format: {
					description: `output format`,
					example: `--format=json`,
					required: false,
				},
				help: {
					description: `show this help text`,
					example: `--help`,
					flag: `h`,
					parse: parseBooleanOption,
					required: false,
				},
				"vscode-install": {
					description: `install the bundled Lasertag VSCode extension with an optional editor command`,
					example: `--vscode-install=code-insiders`,
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

function findSiblingTsxPath(
	cssPath: string,
	fileExists: (filePath: string) => boolean,
): string | undefined {
	const stemPath = cssPath.slice(0, -`.module.css`.length)
	const candidate = `${stemPath}.tsx`

	return fileExists(candidate) ? candidate : undefined
}

function findCliInvocationIndex(args: string[]): number {
	const index = args.findIndex((arg) => path.basename(arg).includes(`lasertag`))

	if (index !== -1) return index

	return Math.min(1, Math.max(args.length - 1, 0))
}

function optionConsumesNextValue(arg: string): boolean {
	return arg === `--format` || arg === `--vscode-install`
}

function extractTargetPatterns(args: string[]): {
	cliArgs: string[]
	targets: string[]
} {
	const invocationIndex = findCliInvocationIndex(args)
	const targets: string[] = []
	const cliArgs = args.slice(0, invocationIndex + 1)
	let inExplicitPositionals = false
	let consumeNextOptionValue = false

	for (const arg of args.slice(invocationIndex + 1)) {
		if (consumeNextOptionValue && !arg.startsWith(`-`)) {
			cliArgs.push(arg)
			consumeNextOptionValue = false
			continue
		}
		consumeNextOptionValue = false

		if (inExplicitPositionals) {
			targets.push(arg)
			continue
		}

		if (arg === `--`) {
			inExplicitPositionals = true
			continue
		}

		if (optionConsumesNextValue(arg)) {
			cliArgs.push(arg)
			consumeNextOptionValue = true
			continue
		}

		if (arg.startsWith(`-`)) {
			cliArgs.push(arg)
			continue
		}

		targets.push(arg)
	}

	return {
		cliArgs,
		targets: targets.length > 0 ? targets : DEFAULT_TARGET_PATTERNS,
	}
}

function resolvePath(cwd: string, filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
}

function defaultVscodeVsixPath(
	fileExists: (filePath: string) => boolean = existsSync,
): string {
	const modulePath = fileURLToPath(import.meta.url)
	const moduleDirectory = path.dirname(modulePath)
	const bundledVsixPath = path.join(moduleDirectory, `vscode`, `Lasertag.vsix`)
	const candidates = [
		bundledVsixPath,
		path.resolve(
			moduleDirectory,
			`..`,
			`..`,
			`dist`,
			`vscode`,
			`Lasertag.vsix`,
		),
	]

	return candidates.find(fileExists) ?? bundledVsixPath
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

function formatStylishDiagnostic(
	diagnostic: LasertagCliDiagnostic,
	cwd: string,
): string {
	const relativeCssPath = path.relative(cwd, diagnostic.cssPath)
	const displayCssPath =
		relativeCssPath && !relativeCssPath.startsWith(`..`)
			? relativeCssPath
			: diagnostic.cssPath

	return [
		`${displayCssPath}:${diagnostic.line}:${diagnostic.column}`,
		diagnostic.code,
		diagnostic.message,
	].join(` `)
}

function formatDiagnostics(
	diagnostics: LasertagCliDiagnostic[],
	format: LasertagOutputFormat,
	files: string[],
	cwd: string,
): string {
	if (format === `json`) {
		return JSON.stringify({ diagnostics, files }, null, 2)
	}

	if (diagnostics.length === 0) {
		const noun = files.length === 1 ? `file` : `files`

		return `lasertag validate: no dead CSS found in ${files.length} ${noun}.`
	}

	return diagnostics
		.map((diagnostic) => formatStylishDiagnostic(diagnostic, cwd))
		.join(`\n`)
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

function validateCssModuleFiles(
	files: string[],
	environment: LasertagCliEnvironment,
): LasertagCliDiagnostic[] {
	const fileExists = environment.fileExists ?? existsSync
	const readFile =
		environment.readFile ?? ((filePath) => readFileSync(filePath, `utf-8`))
	const diagnostics: LasertagCliDiagnostic[] = []

	for (const cssPath of files) {
		const tsxPath = findSiblingTsxPath(cssPath, fileExists)

		if (!tsxPath) continue

		const cssSource = readFile(cssPath)
		const result = validateCssReachability({
			cssPath,
			cssSource,
			tsxPath,
			tsxSource: readFile(tsxPath),
		})

		diagnostics.push(
			...result.diagnostics.map((diagnostic) =>
				createDiagnostic(diagnostic, cssPath, cssSource, tsxPath),
			),
		)
	}

	return diagnostics
}

function runValidate(
	targets: string[],
	options: LasertagOptions,
	io: LasertagCliIO,
	environment: LasertagCliEnvironment,
): LasertagCliResult {
	const cwd = environment.cwd ?? process.cwd()
	const files = discoverCssModuleFiles(targets, environment)
	const diagnostics = validateCssModuleFiles(files, environment)

	io.log(formatDiagnostics(diagnostics, options.format, files, cwd))

	return {
		diagnostics,
		exitCode: diagnostics.length > 0 ? 1 : 0,
		files,
		mode: `validate`,
		options,
		targets,
	}
}

function runFixStub(
	targets: string[],
	options: LasertagOptions,
	io: LasertagCliIO,
): LasertagCliResult {
	io.log(`lasertag fix: dead CSS cleanup is stubbed.`)

	return {
		diagnostics: [],
		exitCode: 0,
		files: [],
		mode: `fix`,
		options,
		targets,
	}
}

function installVscodeExtensionWithEditor(
	request: LasertagVscodeInstallRequest,
): LasertagVscodeInstallResult {
	const child = spawnSync(
		request.editorCommand,
		[`--install-extension`, request.vsixPath, `--force`],
		{
			cwd: request.cwd,
			stdio: `inherit`,
		},
	)

	if (child.error) {
		return {
			error: child.error.message,
			exitCode: 1,
		}
	}

	if (child.signal) {
		return {
			error: `${request.editorCommand} exited from signal ${child.signal}.`,
			exitCode: 1,
		}
	}

	return {
		exitCode: child.status ?? 1,
	}
}

function runVscodeInstall(
	targets: string[],
	options: LasertagOptions,
	io: LasertagCliIO,
	environment: LasertagCliEnvironment,
): LasertagCliResult {
	const cwd = environment.cwd ?? process.cwd()
	const fileExists = environment.fileExists ?? existsSync
	const editorCommand = options[`vscode-install`] || `code`
	const vsixPath = environment.vsixPath ?? defaultVscodeVsixPath(fileExists)

	if (!fileExists(vsixPath)) {
		io.error(
			`lasertag vscode: bundled extension not found at ${vsixPath}. Run pnpm --filter lasertag pack before installing from the workspace.`,
		)

		return {
			diagnostics: [],
			exitCode: 1,
			files: [],
			mode: `vscode-install`,
			options,
			targets,
		}
	}

	const install =
		environment.installVscodeExtension ?? installVscodeExtensionWithEditor
	const result = install({ cwd, editorCommand, vsixPath })

	if (result.error) {
		io.error(`lasertag vscode: ${result.error}`)
	} else if (result.exitCode !== 0) {
		io.error(
			`lasertag vscode: ${editorCommand} exited with code ${result.exitCode}.`,
		)
	} else {
		io.log(`lasertag vscode: installed Lasertag with ${editorCommand}.`)
	}

	return {
		diagnostics: [],
		exitCode: result.exitCode,
		files: [],
		mode: `vscode-install`,
		options,
		targets,
	}
}

export function runLasertagCli(
	args: string[] = process.argv,
	io: LasertagCliIO = console,
	environment: LasertagCliEnvironment = {},
): LasertagCliResult {
	const { cliArgs, targets } = extractTargetPatterns(args)
	const parsed = lasertagCli(cliArgs)
	const { opts } = parsed.inputs

	if (opts.help) {
		io.log(help(lasertagCli.definition))
		return {
			diagnostics: [],
			exitCode: 0,
			files: [],
			mode: `help`,
			options: opts,
			targets,
		}
	}

	if (opts[`vscode-install`] !== undefined) {
		return runVscodeInstall(targets, opts, io, environment)
	}

	if (opts.fix) {
		return runFixStub(targets, opts, io)
	}

	return runValidate(targets, opts, io, environment)
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const result = runLasertagCli()

		process.exitCode = result.exitCode
	} catch (error) {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	}
}
