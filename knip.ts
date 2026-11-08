import type { KnipConfig } from "knip"

export default {
	workspaces: {
		".": {
			// The inspectors are also invoked directly from the contributor docs.
			entry: ["correctly.config.ts", "scripts/*.node.ts"],
			project: ["*.ts", "scripts/**/*.ts"],
			ignoreDependencies: [
				// dprint loads these WASM plugins from paths in dprint.json.
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint-plugin-malva",
				"dprint-plugin-yaml",
			],
		},
		"packages/lasertag": {
			entry: [
				"breakage.config.ts",
				"src/cli/main.ts!",
				"src/eslint/plugin.ts!",
				"src/lsp/server.ts!",
				"src/refractor/index.ts!",
				"src/types/*.d.ts!",
				// The CLI bundles this entry separately when building a VSIX.
				"src/vscode/extension.ts!",
				// Examples and type-test fixtures are loaded outside the module graph.
				"examples/**/*.{ts,tsx}",
				"tests/public/types/fixtures/**/*.tsx",
			],
			project: [
				"*.ts",
				"src/**/*.ts!",
				"{benchmarks,examples,tests}/**/*.{ts,tsx}",
			],
			ignoreDependencies: [
				// The VSIX builder resolves the packaging CLI through a computed path.
				"@vscode/vsce",
				// Provided by the VS Code extension host.
				"vscode",
			],
			ignoreIssues: {
				// This fixture is typechecked against @types/react, never executed.
				"tests/public/types/fixtures/react/ProjectCard.tsx": ["unlisted"],
			},
		},
	},
} satisfies KnipConfig
