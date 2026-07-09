import {
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_COMMAND,
	LASERTAG_CLEAN_UP_DEAD_SELECTORS_KIND,
	LASERTAG_RESTART_SERVER_COMMAND,
} from "../lsp/code-actions.ts"
import {
	resolveBundledTypescriptSdkPath,
	resolveTypescriptSdkPath,
	resolveWorkspacePath,
	withTypescriptSdkPathEnvironment,
} from "./config.ts"

declare const require: (id: string) => unknown

type Disposable = {
	dispose(): void
}

type ExtensionContext = {
	asAbsolutePath(relativePath: string): string
	subscriptions: {
		push(...disposables: Disposable[]): void
	}
}

type VscodeModule = {
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
	workspace: {
		createFileSystemWatcher(globPattern: string): unknown
		getConfiguration(section: string): {
			get<T>(key: string, defaultValue: T): T
		}
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
		],
		outputChannelName: "Lasertag",
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher("**/*.module.css"),
				vscode.workspace.createFileSystemWatcher("**/*.tsx"),
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
}

export function deactivate() {
	if (!client) return

	return client.stop()
}
