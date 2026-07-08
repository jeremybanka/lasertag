const path = require("node:path")

const vscode = require("vscode")
const { LanguageClient, TransportKind } = require("vscode-languageclient/node")

let client

function traceFromSetting(trace) {
	switch (trace) {
		case "messages":
			return 1
		case "verbose":
			return 3
		default:
			return 0
	}
}

function getServerModulePath(context) {
	const configuredPath = vscode.workspace
		.getConfiguration("lasertag")
		.get("server.path", "")
		.trim()

	if (configuredPath) return configuredPath

	return context.asAbsolutePath(path.join("dist", "server", "lsp.mjs"))
}

function createServerOptions(context) {
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

async function activate(context) {
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

function deactivate() {
	if (!client) return

	return client.stop()
}

module.exports = {
	activate,
	deactivate,
}
