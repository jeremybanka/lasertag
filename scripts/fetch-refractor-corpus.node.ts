#!/usr/bin/env node
import { execFile } from "node:child_process"
import type { Dirent } from "node:fs"
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

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

type BaseProvider = {
	name: string
	description: string
	version: string
	renovate: RenovateConfig
	license: string
	maxFiles?: number
	include: IncludePattern[]
}

type GithubArchiveProvider = BaseProvider & {
	source: {
		kind: `github-archive`
		repository: string
		refTemplate: string
	}
}

type NpmSourcemapsProvider = BaseProvider & {
	source: {
		kind: `npm-sourcemaps`
		packageName: string
	}
}

type CorpusProvider = GithubArchiveProvider | NpmSourcemapsProvider

type CorpusManifest = {
	providers: CorpusProvider[]
}

type FetchOptions = {
	dryRun: boolean
	providerNames: Set<string>
}

type SourceMapJson = {
	sources?: unknown
	sourcesContent?: unknown
}

type NpmPackageMetadata = {
	dist?: {
		tarball?: unknown
	}
}

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, `..`)
const corpusRoot = path.join(
	workspaceRoot,
	`packages/lasertag/refractor/corpus`,
)
const manifestPath = path.join(corpusRoot, `manifest.json`)
const providersRoot = path.join(corpusRoot, `providers`)

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2))
	const manifest = await readManifest()
	const providers = selectProviders(manifest.providers, options)

	if (providers.length === 0) {
		throw new Error(`No matching corpus providers were selected.`)
	}

	if (options.dryRun) {
		for (const provider of providers) {
			console.log(
				`${provider.name} ${provider.version} ${sourceLabel(provider)}`,
			)
		}

		return
	}

	await mkdir(providersRoot, { recursive: true })
	const tempRoot = await mkdtemp(
		path.join(os.tmpdir(), `lasertag-refractor-corpus-`),
	)

	try {
		for (const provider of providers) {
			await fetchProvider(provider, tempRoot)
		}
	} finally {
		await rm(tempRoot, { force: true, recursive: true })
	}
}

function parseArgs(args: string[]): FetchOptions {
	const providerNames = new Set<string>()
	let dryRun = false

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === `--dry-run`) {
			dryRun = true
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

		throw new Error(`Unknown argument: ${arg}`)
	}

	return { dryRun, providerNames }
}

function selectProviders(
	providers: CorpusProvider[],
	options: FetchOptions,
): CorpusProvider[] {
	if (options.providerNames.size === 0) return providers

	const selectedProviders = providers.filter((provider) =>
		options.providerNames.has(provider.name),
	)
	const selectedNames = new Set(
		selectedProviders.map((provider) => provider.name),
	)
	const missingNames = [...options.providerNames].filter(
		(providerName) => !selectedNames.has(providerName),
	)

	if (missingNames.length > 0) {
		throw new Error(`Unknown corpus provider(s): ${missingNames.join(`, `)}`)
	}

	return selectedProviders
}

async function readManifest(): Promise<CorpusManifest> {
	return JSON.parse(await readFile(manifestPath, `utf8`)) as CorpusManifest
}

async function fetchProvider(
	provider: CorpusProvider,
	tempRoot: string,
): Promise<void> {
	console.log(`Fetching ${provider.name} ${provider.version}`)

	const providerRoot = path.join(providersRoot, provider.name)
	await rm(providerRoot, { force: true, recursive: true })
	await mkdir(providerRoot, { recursive: true })

	const copiedFiles = isGithubArchiveProvider(provider)
		? await fetchGithubArchiveProvider(provider, providerRoot, tempRoot)
		: await fetchNpmSourcemapsProvider(provider, providerRoot, tempRoot)

	if (copiedFiles.length === 0) {
		throw new Error(`Provider ${provider.name} did not produce any files.`)
	}

	await writeMetadata(provider, providerRoot, copiedFiles)
	console.log(`Fetched ${copiedFiles.length} file(s) for ${provider.name}`)
}

async function fetchGithubArchiveProvider(
	provider: GithubArchiveProvider,
	providerRoot: string,
	tempRoot: string,
): Promise<string[]> {
	const ref = renderRef(provider.source.refTemplate, provider.version)
	const url = `https://github.com/${provider.source.repository}/archive/refs/tags/${encodeURIComponent(
		ref,
	)}.tar.gz`
	const archiveRoot = path.join(tempRoot, provider.name)
	const tarballPath = path.join(tempRoot, `${provider.name}.tar.gz`)

	await mkdir(archiveRoot, { recursive: true })
	await download(url, tarballPath)
	await extractTarball(tarballPath, archiveRoot)

	const sourceRoot = await findArchiveRoot(archiveRoot)
	const files = await listFiles(sourceRoot)
	const selectedFiles = files
		.map((filePath) => ({
			absolutePath: filePath,
			relativePath: toPosixPath(path.relative(sourceRoot, filePath)),
		}))
		.filter((file) => file.relativePath.endsWith(`.tsx`))
		.filter((file) => matchesIncludes(file.relativePath, provider.include))
		.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
		.slice(0, provider.maxFiles)

	const copiedFiles: string[] = []

	for (const file of selectedFiles) {
		const outputPath = path.join(providerRoot, `files`, file.relativePath)
		await mkdir(path.dirname(outputPath), { recursive: true })
		await copyFile(file.absolutePath, outputPath)
		copiedFiles.push(file.relativePath)
	}

	return copiedFiles
}

async function fetchNpmSourcemapsProvider(
	provider: NpmSourcemapsProvider,
	providerRoot: string,
	tempRoot: string,
): Promise<string[]> {
	const metadata = await fetchJson<NpmPackageMetadata>(
		`https://registry.npmjs.org/${encodeURIComponent(
			provider.source.packageName,
		)}/${provider.version}`,
	)
	const tarballUrl = metadata.dist?.tarball

	if (typeof tarballUrl !== `string`) {
		throw new Error(
			`Could not resolve npm tarball for ${provider.source.packageName}@${provider.version}.`,
		)
	}

	const archiveRoot = path.join(tempRoot, provider.name)
	const tarballPath = path.join(tempRoot, `${provider.name}.tgz`)
	await mkdir(archiveRoot, { recursive: true })
	await download(tarballUrl, tarballPath)
	await extractTarball(tarballPath, archiveRoot)

	const sourceRoot = await findArchiveRoot(archiveRoot)
	const mapFiles = (await listFiles(sourceRoot)).filter((filePath) =>
		filePath.endsWith(`.map`),
	)
	const sourceFiles = new Map<string, string>()

	for (const mapFile of mapFiles) {
		const sourceMap = JSON.parse(
			await readFile(mapFile, `utf8`),
		) as SourceMapJson
		const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : []
		const sourcesContent = Array.isArray(sourceMap.sourcesContent)
			? sourceMap.sourcesContent
			: []

		for (const [sourceIndex, source] of sources.entries()) {
			const sourceContent = sourcesContent[sourceIndex]

			if (
				typeof source !== `string` ||
				typeof sourceContent !== `string` ||
				!source.endsWith(`.tsx`) ||
				!matchesIncludes(toPosixPath(source), provider.include)
			) {
				continue
			}

			sourceFiles.set(toPosixPath(source), sourceContent)
		}
	}

	const selectedFiles = [...sourceFiles]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, provider.maxFiles)
	const copiedFiles: string[] = []

	for (const [sourcePath, sourceContent] of selectedFiles) {
		const outputRelativePath = path.join(
			`sourcemaps`,
			safeRelativeSourcePath(sourcePath),
		)
		const outputPath = path.join(providerRoot, `files`, outputRelativePath)
		await mkdir(path.dirname(outputPath), { recursive: true })
		await writeFile(outputPath, sourceContent)
		copiedFiles.push(toPosixPath(outputRelativePath))
	}

	return copiedFiles
}

async function writeMetadata(
	provider: CorpusProvider,
	providerRoot: string,
	files: string[],
): Promise<void> {
	const metadata = {
		description: provider.description,
		fetchedAt: new Date().toISOString(),
		files,
		license: provider.license,
		name: provider.name,
		renovate: provider.renovate,
		source: provider.source,
		version: provider.version,
	}

	await writeFile(
		path.join(providerRoot, `metadata.json`),
		`${JSON.stringify(metadata, null, `\t`)}\n`,
	)
}

function sourceLabel(provider: CorpusProvider): string {
	if (isGithubArchiveProvider(provider)) {
		return `github:${provider.source.repository}#${renderRef(
			provider.source.refTemplate,
			provider.version,
		)}`
	}

	return `npm:${provider.source.packageName}@${provider.version} sourcemaps`
}

function isGithubArchiveProvider(
	provider: CorpusProvider,
): provider is GithubArchiveProvider {
	return provider.source.kind === `github-archive`
}

function renderRef(template: string, version: string): string {
	return template.replaceAll(`{{version}}`, version)
}

async function download(url: string, outputPath: string): Promise<void> {
	const response = await fetch(url, {
		headers: {
			"user-agent": `lasertag-refractor-corpus`,
		},
	})

	if (!response.ok) {
		throw new Error(`Download failed for ${url}: ${response.status}`)
	}

	await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			"user-agent": `lasertag-refractor-corpus`,
		},
	})

	if (!response.ok) {
		throw new Error(`Fetch failed for ${url}: ${response.status}`)
	}

	return (await response.json()) as T
}

async function extractTarball(
	tarballPath: string,
	outputDirectory: string,
): Promise<void> {
	await execFileAsync(`tar`, [`-xzf`, tarballPath, `-C`, outputDirectory])
}

async function findArchiveRoot(directoryPath: string): Promise<string> {
	const directoryEntries = await readdir(directoryPath, { withFileTypes: true })
	const directories = directoryEntries.filter((entry) => entry.isDirectory())

	return directories.length === 1
		? path.join(directoryPath, directories[0]!.name)
		: directoryPath
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

function matchesIncludes(
	relativePath: string,
	includePatterns: IncludePattern[],
): boolean {
	return includePatterns.some((includePattern) =>
		globToRegExp(includePattern.from).test(relativePath),
	)
}

function globToRegExp(glob: string): RegExp {
	const doubleStarSlash = `\u0000DOUBLE_STAR_SLASH\u0000`
	const doubleStar = `\u0000DOUBLE_STAR\u0000`
	const escaped = toPosixPath(glob).replace(/[.+^${}()|[\]\\]/g, `\\$&`)
	const pattern = escaped
		.replaceAll(`**/`, doubleStarSlash)
		.replaceAll(`**`, doubleStar)
		.replaceAll(`*`, `[^/]*`)
		.replaceAll(doubleStarSlash, `(?:.*/)?`)
		.replaceAll(doubleStar, `.*`)

	return new RegExp(`^${pattern}$`)
}

function safeRelativeSourcePath(sourcePath: string): string {
	return toPosixPath(sourcePath)
		.split(`/`)
		.filter((part) => part && part !== `.` && part !== `..`)
		.join(`/`)
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
