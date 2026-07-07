import { describe, expect, it } from "vitest"
import { DiagnosticSeverity } from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"

import {
	createInitializeResult,
	createRefractorDiagnostics,
	findSiblingTsxPath,
} from "../src/server.ts"

describe(`lasertag lsp`, () => {
	it(`advertises incremental text document sync`, () => {
		expect(createInitializeResult()).toMatchObject({
			capabilities: {
				textDocumentSync: 2,
			},
			serverInfo: {
				name: `lasertag-lsp`,
			},
		})
	})

	it(`finds a sibling tsx file for a css module`, () => {
		expect(
			findSiblingTsxPath(
				`/project/src/AppPanel.module.css`,
				(filePath) => filePath === `/project/src/AppPanel.tsx`,
			),
		).toBe(`/project/src/AppPanel.tsx`)
	})

	it(`does not create diagnostics for non-css-module documents`, () => {
		const document = TextDocument.create(
			`file:///project/src/globals.css`,
			`css`,
			1,
			`body { margin: 0; }`,
		)

		expect(createRefractorDiagnostics(document)).toEqual([])
	})

	it(`maps refractor dead selector diagnostics into LSP diagnostics`, () => {
		const document = TextDocument.create(
			`file:///project/src/AppPanel.module.css`,
			`css`,
			1,
			`
				app-panel.class {
					> footer {}
				}
			`,
		)
		const diagnostics = createRefractorDiagnostics(document, {
			cssPath: `/project/src/AppPanel.module.css`,
			fileExists: (filePath) => filePath === `/project/src/AppPanel.tsx`,
			readFile: () => `
				import css from "./AppPanel.module.css"

				export function AppPanel() {
					return (
						<app-panel className={css.class}>
							<header />
						</app-panel>
					)
				}
			`,
		})

		expect(diagnostics).toMatchObject([
			{
				code: `dead-selector`,
				severity: DiagnosticSeverity.Warning,
				source: `lasertag`,
			},
		])
		expect(diagnostics[0]?.message).toContain(`does not match`)
	})
})
