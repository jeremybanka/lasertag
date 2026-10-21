import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { createMapperProcess } from "../refractor/mapper-process.ts"

import type {
	CancellationToken,
	Location,
	LocationLink,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	analyzeAstroSemanticEvidence,
	astroComponentAtOffset,
} from "../refractor/astro-semantic-evidence.ts"
import { createTypescriptAstSession } from "../refractor/typescript-ast.ts"

export const ASTRO_NAVIGATION_WORKER = `lasertag-astro-navigation`

export function astroNavigationEnabled(
	initializationOptions: unknown,
): boolean {
	if (
		!initializationOptions ||
		typeof initializationOptions !== `object` ||
		!(`astroNavigation` in initializationOptions)
	)
		return false
	const options = initializationOptions.astroNavigation
	return (
		typeof options === `object` &&
		options !== null &&
		`enabled` in options &&
		options.enabled === true &&
		`runExternalCode` in options &&
		options.runExternalCode === true
	)
}

export type AstroNavigationTask = {
	filePath: string
	sourceText: string
	offset: number
	openFiles: Array<[string, string]>
	diskRevision: number
}

export type AstroNavigationTarget = {
	kind: `source` | `ambient`
	link: LocationLink
}

export function navigationLocations(
	targets: AstroNavigationTarget[],
	kind: AstroNavigationTarget[`kind`],
	linkSupport: boolean,
): LocationLink[] | Location[] {
	const links = targets
		.filter((target) => target.kind === kind)
		.map((target) => target.link)
	return linkSupport
		? links
		: links.map((link) => ({
				uri: link.targetUri,
				range: link.targetSelectionRange,
			}))
}

/** One session per worker. The entire current overlay set is supplied per request. */
export function createAstroNavigationAnalyzer() {
	const session = createTypescriptAstSession({ runExternalCode: true })
	let diskRevision: number | undefined
	return {
		close: () => session.close(),
		analyze(task: AstroNavigationTask): AstroNavigationTarget[] {
			const reference = astroComponentAtOffset(task.sourceText, task.offset)
			if (!reference) return []
			const openFiles = new Map(task.openFiles)
			openFiles.set(task.filePath, task.sourceText)
			const invalidate =
				diskRevision !== undefined && diskRevision !== task.diskRevision
			diskRevision = task.diskRevision
			const result = analyzeAstroSemanticEvidence(
				{
					filePath: task.filePath,
					sourceText: task.sourceText,
					typescriptSource: { openFiles, invalidate },
				},
				session,
			)
			if (result.semantics.status !== `available`) return []
			const component = result.semantics.components.find(
				({ range }) => range.start === reference.range.start,
			)
			if (component?.status !== `resolved`) return []
			const source = TextDocument.create(
				pathToFileURL(task.filePath).href,
				`astro`,
				0,
				task.sourceText,
			)
			// For closing tags, highlight the authored name at the request position.
			const openingStart = task.sourceText.lastIndexOf(`<`, task.offset)
			const start =
				task.sourceText[openingStart + 1] === `/`
					? openingStart + 2
					: reference.range.start
			const originSelectionRange = {
				start: source.positionAt(start),
				end: source.positionAt(start + reference.name.length),
			}
			const targets: AstroNavigationTarget[] = []
			for (const declaration of component.declarations) {
				try {
					const text =
						openFiles.get(declaration.sourcePath) ??
						readFileSync(declaration.sourcePath, `utf8`)
					const uri = pathToFileURL(declaration.sourcePath).href
					const target = TextDocument.create(uri, ``, 0, text)
					const range = declaration.range ?? { start: 0, end: 0 }
					if (
						range.start < 0 ||
						range.end < range.start ||
						range.end > text.length
					)
						continue
					const targetRange = {
						start: target.positionAt(range.start),
						end: target.positionAt(range.end),
					}
					targets.push({
						kind: declaration.kind,
						link: {
							originSelectionRange,
							targetUri: uri,
							targetRange,
							targetSelectionRange: targetRange,
						},
					})
				} catch {
					// A target deleted during a request is unavailable, not a guessed link.
				}
			}
			return targets.filter(
				(target, index) =>
					targets.findIndex(
						(candidate) => JSON.stringify(candidate) === JSON.stringify(target),
					) === index,
			)
		},
	}
}

type WorkerRequest = { id: number; task: AstroNavigationTask } | { close: true }
type WorkerResponse = { id: number; result: AstroNavigationTarget[] }

export function runAstroNavigationWorker(): void {
	const analyzer = createAstroNavigationAnalyzer()
	process.on(`message`, (request: WorkerRequest) => {
		if (`close` in request) {
			analyzer.close()
			process.disconnect?.()
			return
		}
		let targets: AstroNavigationTarget[] = []
		try {
			targets = analyzer.analyze(request.task)
		} catch {
			/* Fail closed; CSS analysis uses another path. */
		}
		process.send?.({ id: request.id, result: targets } satisfies WorkerResponse)
	})
}

export function createAstroNavigationService(
	workerModule: string | URL,
	timeoutMs = 10_000,
) {
	const service = createMapperProcess<
		AstroNavigationTask,
		AstroNavigationTarget[]
	>(workerModule, ASTRO_NAVIGATION_WORKER, timeoutMs)
	return {
		reset: service.reset,
		async request(task: AstroNavigationTask, token: CancellationToken) {
			return (await service.request(task, token)) ?? []
		},
	}
}
