import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
	LASERTAG_RESTART_SERVER_COMMAND,
} from "../lsp/code-actions.ts"
import {
	LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION,
	LASERTAG_RENDER_STORY_REQUEST,
	type LasertagRenderStoryChangedNotification,
	type LasertagRenderStoryRequest,
	type LasertagRenderStoryView,
	type RenderStoryViewLocation,
} from "../lsp/render-story-view.ts"
import {
	resolveBundledTypescriptSdkPath,
	resolveTypescriptSdkPath,
	resolveWorkspacePath,
	withTypescriptSdkPathEnvironment,
} from "./config.ts"
import {
	createRenderStoryTree,
	LASERTAG_IN_CONTEXT_KEY,
	LASERTAG_OPEN_RENDER_SOURCE_COMMAND,
	LASERTAG_OPEN_STORY_LOCATION_COMMAND,
	LASERTAG_OPEN_STYLES_COMMAND,
	LASERTAG_RENDER_STORY_VIEW_ID,
	type RenderStoryTreeEntry,
} from "./render-story-tree.ts"

declare const require: (id: string) => unknown

type Disposable = {
	dispose(): void
}

type Uri = {
	path: string
	scheme: string
	toString(): string
}

type Position = {
	character: number
	line: number
}

type TextDocument = {
	positionAt(offset: number): Position
	uri: Uri
}

type TextEditor = {
	document: TextDocument
	revealRange(range: unknown, revealType?: unknown): void
	selection: unknown
}

type TreeItem = {
	command?: {
		arguments?: unknown[]
		command: string
		title: string
	}
	description?: string
	iconPath?: unknown
	resourceUri?: Uri
	tooltip?: string
}

type ExtensionContext = {
	asAbsolutePath(relativePath: string): string
	subscriptions: {
		push(...disposables: Disposable[]): void
	}
}

type VscodeModule = {
	EventEmitter: new <T>() => {
		dispose(): void
		event: (listener: (event: T) => unknown) => Disposable
		fire(event: T): void
	}
	Range: new (start: Position, end: Position) => unknown
	Selection: new (start: Position, end: Position) => unknown
	ThemeColor: new (id: string) => unknown
	ThemeIcon: new (id: string, color?: unknown) => unknown
	TreeItem: new (label: string, collapsibleState?: number) => TreeItem
	TreeItemCollapsibleState: {
		Collapsed: number
		Expanded: number
		None: number
	}
	TextEditorRevealType: {
		InCenterIfOutsideViewport: unknown
	}
	Uri: {
		parse(value: string): Uri
	}
	commands: {
		executeCommand<T = unknown>(
			command: string,
			...args: unknown[]
		): PromiseLike<T>
		registerCommand(
			command: string,
			callback: (...args: unknown[]) => unknown,
		): Disposable
	}
	window: {
		activeTextEditor?: TextEditor
		onDidChangeActiveTextEditor(
			listener: (editor: TextEditor | undefined) => unknown,
		): Disposable
		registerFileDecorationProvider(provider: {
			provideFileDecoration(uri: Uri): unknown
		}): Disposable
		registerTreeDataProvider<T>(
			viewId: string,
			provider: {
				getChildren(element?: T): T[] | PromiseLike<T[]>
				getTreeItem(element: T): TreeItem
				onDidChangeTreeData: (
					listener: (event: T | undefined) => unknown,
				) => Disposable
			},
		): Disposable
		showTextDocument(
			document: TextDocument,
			options?: { preview?: boolean },
		): PromiseLike<TextEditor>
	}
	workspace: {
		createFileSystemWatcher(globPattern: string): unknown
		getConfiguration(section: string): {
			get<T>(key: string, defaultValue: T): T
		}
		openTextDocument(uri: Uri): PromiseLike<TextDocument>
		workspaceFolders?: Array<{
			uri: {
				fsPath: string
			}
		}>
	}
}

const path = require("node:path") as typeof import("node:path")
const vscode = require("vscode") as VscodeModule
const { LanguageClient, TransportKind } =
	require("vscode-languageclient/node") as typeof import("vscode-languageclient/node")

type InitializeParams = import("vscode-languageclient/node").InitializeParams

class LasertagLanguageClient extends LanguageClient {
	protected override fillInitializeParams(params: InitializeParams): void {
		super.fillInitializeParams(params)
		// VS Code Remote can report a client PID outside the server's namespace.
		params.processId = null
	}
}

let client: InstanceType<typeof LasertagLanguageClient> | undefined

class RenderStoryTreeProvider {
	readonly onDidChangeTreeData
	#activeUri: string | undefined
	#entries: RenderStoryTreeEntry[] = []
	#emitter = new vscode.EventEmitter<RenderStoryTreeEntry | undefined>()
	#requestVersion = 0
	#view: LasertagRenderStoryView = { kind: `outside-context` }

	constructor() {
		this.onDidChangeTreeData = this.#emitter.event
	}

	dispose(): void {
		this.#emitter.dispose()
	}

	getChildren(element?: RenderStoryTreeEntry): RenderStoryTreeEntry[] {
		return element ? element.children : this.#entries
	}

	getTreeItem(entry: RenderStoryTreeEntry): TreeItem {
		const item = new vscode.TreeItem(
			entry.label,
			entry.children.length > 0
				? entry.expanded
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
		)

		if (entry.description) item.description = entry.description
		if (entry.tooltip) item.tooltip = entry.tooltip

		if (entry.icon) {
			const color =
				entry.decoration === `unreachable`
					? new vscode.ThemeColor(`list.errorForeground`)
					: entry.decoration === `unsupported`
						? new vscode.ThemeColor(`disabledForeground`)
						: new vscode.ThemeColor(`foreground`)

			item.iconPath = new vscode.ThemeIcon(entry.icon, color)
		}

		if (entry.decoration) {
			item.resourceUri = vscode.Uri.parse(
				`lasertag-story:/${entry.decoration}/${encodeURIComponent(entry.label)}`,
			)
		}

		if (entry.location) {
			item.command = {
				arguments: [entry.location],
				command: LASERTAG_OPEN_STORY_LOCATION_COMMAND,
				title: `Open ${entry.label}`,
			}
		}

		return item
	}

	get cssLocation(): RenderStoryViewLocation | undefined {
		return this.#view.kind === `ready` || this.#view.kind === `unavailable`
			? this.#view.cssLocation
			: undefined
	}

	get sourceLocation(): RenderStoryViewLocation | undefined {
		return this.#view.kind === `ready` || this.#view.kind === `unavailable`
			? this.#view.sourceLocation
			: undefined
	}

	async refresh(activeUri = this.#activeUri): Promise<void> {
		this.#activeUri = activeUri
		const requestVersion = ++this.#requestVersion
		let view: LasertagRenderStoryView = { kind: `outside-context` }

		if (activeUri && client) {
			try {
				view = await client.sendRequest<LasertagRenderStoryView>(
					LASERTAG_RENDER_STORY_REQUEST,
					{ uri: activeUri } satisfies LasertagRenderStoryRequest,
				)
			} catch {
				view = { kind: `outside-context` }
			}
		}

		if (requestVersion !== this.#requestVersion) return

		this.#view = view
		this.#entries = createRenderStoryTree(view)
		await vscode.commands.executeCommand(
			`setContext`,
			LASERTAG_IN_CONTEXT_KEY,
			view.kind !== `outside-context`,
		)
		this.#emitter.fire(undefined)
	}
}

class RenderStoryDecorationProvider {
	provideFileDecoration(uri: Uri): unknown {
		if (uri.scheme !== `lasertag-story`) return

		if (uri.path.startsWith(`/regular/`)) {
			return {
				color: new vscode.ThemeColor(`foreground`),
				propagate: false,
			}
		}

		if (uri.path.startsWith(`/unsupported/`)) {
			return {
				color: new vscode.ThemeColor(`disabledForeground`),
				propagate: false,
				tooltip: `Unstyled branch`,
			}
		}

		if (uri.path.startsWith(`/unreachable/`)) {
			return {
				color: new vscode.ThemeColor(`list.errorForeground`),
				propagate: false,
				tooltip: `Styled, but unreachable`,
			}
		}
	}
}

async function openStoryLocation(
	location: RenderStoryViewLocation | undefined,
): Promise<void> {
	if (!location) return

	const document = await vscode.workspace.openTextDocument(
		vscode.Uri.parse(location.uri),
	)
	const editor = await vscode.window.showTextDocument(document, {
		preview: false,
	})
	const start = document.positionAt(location.start)
	const end = document.positionAt(location.end)
	const range = new vscode.Range(start, end)

	editor.selection = new vscode.Selection(start, end)
	editor.revealRange(
		range,
		vscode.TextEditorRevealType.InCenterIfOutsideViewport,
	)
}

function traceFromSetting(trace: string): 0 | 1 | 3 {
	switch (trace) {
		case "messages":
			return 1
		case "verbose":
			return 3
		default:
			return 0
	}
}

function getServerModulePath(context: ExtensionContext): string {
	const configuredPath = vscode.workspace
		.getConfiguration("lasertag")
		.get("server.path", "")
		.trim()

	if (configuredPath) return configuredPath

	return context.asAbsolutePath(path.join("dist", "server.mjs"))
}

function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function getConfiguredLspPath(): string | undefined {
	const configuredPath = vscode.workspace
		.getConfiguration("lasertag")
		.get("lsp.path", "")
	return resolveWorkspacePath(configuredPath, getWorkspaceRoot())
}

function getTypescriptSdkPath(context: ExtensionContext): string {
	const configuredPath = vscode.workspace
		.getConfiguration("lasertag")
		.get("typescript.sdk.path", "")
	const bundledPath = resolveBundledTypescriptSdkPath(
		context.asAbsolutePath("."),
	)

	return resolveTypescriptSdkPath(
		configuredPath,
		getWorkspaceRoot(),
		bundledPath,
	)
}

function getConfiguredLogLevel(): string {
	return vscode.workspace.getConfiguration("lasertag").get("log.level", "info")
}

function createServerEnvironment(context: ExtensionContext) {
	const baseEnvironment = {
		...process.env,
		ELECTRON_NO_ASAR: "1",
		ELECTRON_RUN_AS_NODE: "1",
		LASERTAG_LSP_LOG_LEVEL: getConfiguredLogLevel(),
	}

	return withTypescriptSdkPathEnvironment(
		baseEnvironment,
		getTypescriptSdkPath(context),
	)
}

function createServerOptions(context: ExtensionContext) {
	const command = getConfiguredLspPath()

	if (command) {
		const workspaceRoot = getWorkspaceRoot()
		const executable = {
			args: [],
			command,
			options: {
				env: createServerEnvironment(context),
				...(workspaceRoot ? { cwd: workspaceRoot } : {}),
			},
			transport: TransportKind.stdio,
		}

		return {
			debug: executable,
			run: executable,
		}
	}

	const module = getServerModulePath(context)
	const workspaceRoot = getWorkspaceRoot()
	const options = {
		env: createServerEnvironment(context),
		...(workspaceRoot ? { cwd: workspaceRoot } : {}),
	}

	return {
		debug: {
			args: ["--nolazy", "--inspect=6011", module],
			command: process.execPath,
			options,
			transport: TransportKind.stdio,
		},
		run: {
			args: [module],
			command: process.execPath,
			options,
			transport: TransportKind.stdio,
		},
	}
}

function createClientOptions() {
	return {
		documentSelector: [
			{
				language: "css",
				pattern: "**/*.module.css",
				scheme: "file",
			},
			{
				language: "typescriptreact",
				scheme: "file",
			},
			{
				language: "astro",
				scheme: "file",
			},
		],
		outputChannelName: "Lasertag",
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher("**/*.module.css"),
				vscode.workspace.createFileSystemWatcher("**/*.tsx"),
				vscode.workspace.createFileSystemWatcher("**/*.astro"),
			],
		},
	}
}

export async function activate(context: ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			LASERTAG_RESTART_SERVER_COMMAND,
			async () => {
				await client?.restart()
			},
		),
		vscode.commands.registerCommand(
			LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
			async () => {
				await vscode.commands.executeCommand("editor.action.codeAction", {
					apply: "first",
					kind: LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
				})
			},
		),
	)

	client = new LasertagLanguageClient(
		"lasertag",
		"lasertag",
		createServerOptions(context),
		createClientOptions(),
	)

	context.subscriptions.push({
		dispose: () => {
			if (client) void client.stop()
		},
	})

	const trace = vscode.workspace
		.getConfiguration("lasertag")
		.get("trace.server", "off")

	await client.setTrace(traceFromSetting(trace))
	await client.start()

	const storyTreeProvider = new RenderStoryTreeProvider()

	context.subscriptions.push(
		storyTreeProvider,
		vscode.window.registerTreeDataProvider(
			LASERTAG_RENDER_STORY_VIEW_ID,
			storyTreeProvider,
		),
		vscode.window.registerFileDecorationProvider(
			new RenderStoryDecorationProvider(),
		),
		vscode.commands.registerCommand(
			LASERTAG_OPEN_STORY_LOCATION_COMMAND,
			(location: unknown) =>
				openStoryLocation(location as RenderStoryViewLocation),
		),
		vscode.commands.registerCommand(LASERTAG_OPEN_STYLES_COMMAND, () =>
			openStoryLocation(storyTreeProvider.cssLocation),
		),
		vscode.commands.registerCommand(LASERTAG_OPEN_RENDER_SOURCE_COMMAND, () =>
			openStoryLocation(storyTreeProvider.sourceLocation),
		),
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			void storyTreeProvider.refresh(editor?.document.uri.toString())
		}),
		client.onNotification(
			LASERTAG_RENDER_STORY_CHANGED_NOTIFICATION,
			(_notification: LasertagRenderStoryChangedNotification) => {
				void storyTreeProvider.refresh()
			},
		),
	)

	await storyTreeProvider.refresh(
		vscode.window.activeTextEditor?.document.uri.toString(),
	)
}

export function deactivate() {
	if (!client) return

	return client.stop()
}
