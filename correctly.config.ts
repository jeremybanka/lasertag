import { defineConfig, GITIGNORE, json, jsonc, toml, yaml } from "correctly"
import { renovate } from "correctly/extensions/renovate"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	remote: { maxBytes: 8 * 1024 * 1024 },
	exclude: [
		GITIGNORE,
		"**/pnpm-lock.yaml",
		"**/bun.lock",
		"**/fixtures/**",
		"**/refractor/corpus/providers/**",
		"**/refractor/corpus/reports/**",
	],
	associations: [
		{
			name: "Changesets",
			files: [".changeset/config.json"],
			parse: json(),
			validate: ajv({ schema: "node_modules/@changesets/config/schema.json" }),
		},
		{
			name: "Dprint",
			files: ["**/dprint.json"],
			parse: json(),
			packages: [
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint",
				"dprint-plugin-malva",
				"dprint-plugin-markup",
				"dprint-plugin-yaml",
			],
			validate: ajv({ schema: "https://dprint.dev/schemas/v0.json" }),
		},
		{
			name: "Renovate",
			files: ["renovate.json"],
			parse: json(),
			validate: ajv({
				// Initial snapshot matches atom.io: renovate@44.148.4, before the
				// upstream installTools schema regression. Refresh Renovate explicitly.
				// https://unpkg.com/renovate@44.148.4/renovate-schema.json
				schema: "https://docs.renovatebot.com/renovate-schema.json",
				extensions: [renovate()],
			}),
		},
		{
			name: "Refractor corpus",
			files: ["packages/lasertag/tests/private/refractor/corpus/manifest.json"],
			parse: json(),
			validate: ajv({
				schema:
					"packages/lasertag/tests/private/refractor/corpus/manifest.schema.json",
			}),
		},
		{
			name: "TypeScript and editor settings",
			files: ["**/tsconfig*.json", "**/.vscode/*.json", "**/.zed/*.json"],
			parse: jsonc(),
			validate: null,
		},
		{
			name: "GitHub workflows",
			files: [".github/workflows/*.{yml,yaml}"],
			parse: yaml(),
			validate: ajv({
				schema: "https://www.schemastore.org/github-workflow.json",
			}),
		},
		{
			name: "GitHub actions",
			files: [".github/actions/**/action.{yml,yaml}"],
			parse: yaml(),
			validate: ajv({
				schema: "https://www.schemastore.org/github-action.json",
			}),
		},
		{
			name: "pnpm workspace",
			files: ["pnpm-workspace.yaml"],
			parse: yaml(),
			validate: ajv({
				schema: "https://www.schemastore.org/pnpm-workspace.json",
			}),
		},
		{
			name: "Mise",
			files: ["**/mise.toml"],
			parse: toml(),
			validate: ajv({ schema: "https://mise.jdx.dev/schema/mise.json" }),
		},
	],
})
