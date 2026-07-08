declare const require: (id: string) => unknown

type Disposable = {
	dispose(): void
}

type ExtensionContext = {
	asAbsolutePath(relativePath: string): string
	subscriptions: {
		push(disposable: Disposable): void
	}
}

type VscodeModule = {
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

let client: InstanceType<typeof LanguageClient> | undefined

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
		.trim()

	if (!configuredPath) return undefined
	if (path.isAbsolute(configuredPath)) return configuredPath

	const workspaceRoot = getWorkspaceRoot()

	return workspaceRoot
		? path.join(workspaceRoot, configuredPath)
		: configuredPath
}

function createServerOptions(context: ExtensionContext) {
	const command = getConfiguredLspPath()

	if (command) {
		const workspaceRoot = getWorkspaceRoot()
		const executable = {
			args: ["--stdio"],
			command,
			...(workspaceRoot ? { options: { cwd: workspaceRoot } } : {}),
			transport: TransportKind.stdio,
		}

		return {
			debug: executable,
			run: executable,
		}
	}

	const module = getServerModulePath(context)
	const debugOptions = {
		execArgv: ["--nolazy", "--inspect=6011"],
	}

	return {
		debug: {
			module,
			options: debugOptions,
			transport: TransportKind.ipc,
		},
		run: {
			module,
			transport: TransportKind.ipc,
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
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher("**/*.module.css"),
				vscode.workspace.createFileSystemWatcher("**/*.tsx"),
			],
		},
	}
}

export async function activate(context: ExtensionContext) {
	client = new LanguageClient(
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
