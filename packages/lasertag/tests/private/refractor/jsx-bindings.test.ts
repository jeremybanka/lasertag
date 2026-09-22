import type { Node } from "typescript/unstable/ast"
import { expect, it } from "vite-plus/test"

import { analyzeTsxRenderStory } from "../../../src/refractor/analyze-tsx.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstSession,
} from "../../../src/refractor/typescript-ast.ts"

it(`resolves each JSX binding once per analysis and refreshes after edits`, () => {
	const session = createTypescriptAstSession()
	const counts = new Map<Node, number>()
	const tracked: TypescriptAstSession = {
		...session,
		withSourceFile(sourceText, filePath, use) {
			return session.withSourceFile(
				sourceText,
				filePath,
				(sourceFile, analysis) =>
					use(sourceFile, {
						resolveAliasedDeclarations(node) {
							if (node.getText() === `LocalPanel`)
								counts.set(node, (counts.get(node) ?? 0) + 1)
							return analysis.resolveAliasedDeclarations(node)
						},
					}),
			)
		},
	}
	try {
		const analyze = (parameters: string) =>
			analyzeTsxRenderStory(
				{
					filePath: `/project/AppPanel.tsx`,
					sourceText: `function LocalPanel() { return <span /> }
export function AppPanel(${parameters}) { return <app-panel class={css.class}><LocalPanel /></app-panel> }`,
				},
				tracked,
			)
		expect(analyze(``).roots).toMatchObject([
			{ kind: `element`, children: [{ kind: `element`, tagName: `span` }] },
		])
		expect(analyze(`{ LocalPanel }`).roots).toMatchObject([
			{ kind: `element`, children: [{ kind: `opaque` }] },
		])
		expect([...counts.values()]).toEqual([1, 1])
	} finally {
		session.close()
	}
})
