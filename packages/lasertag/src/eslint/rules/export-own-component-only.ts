import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"
import path from "node:path"

const MESSAGE_ID = `exportOwnComponentOnly`

type ExportNamedDeclaration = ESTree.ExportNamedDeclaration & {
	exportKind?: `type` | `value`
}

type ExportSpecifier = ESTree.ExportSpecifier & {
	exportKind?: `type` | `value`
}

function getExpectedExportName(filename: string): string {
	return path.parse(filename).name
}

function getDeclarationNameNodes(
	declaration: ESTree.Declaration,
): ESTree.Identifier[] {
	switch (declaration.type) {
		case `FunctionDeclaration`:
		case `ClassDeclaration`:
			return declaration.id ? [declaration.id] : []
		case `VariableDeclaration`:
			return declaration.declarations.flatMap((declarator) =>
				declarator.id.type === `Identifier` ? [declarator.id] : [],
			)
		default:
			return []
	}
}

function isTypeOnlyExport(node: ExportNamedDeclaration): boolean {
	return node.exportKind === `type`
}

function getDefaultExportNameNode(
	node: ESTree.ExportDefaultDeclaration,
): ESTree.Identifier | undefined {
	const { declaration } = node

	if (
		declaration.type === `FunctionDeclaration` ||
		declaration.type === `ClassDeclaration`
	) {
		return declaration.id ?? undefined
	}

	return declaration.type === `Identifier` ? declaration : undefined
}

export const exportOwnComponentOnly: {
	meta: {
		type: RuleType
		docs: {
			description: string
			recommended: boolean
			url: string
		}
		messages: {
			exportOwnComponentOnly: string
		}
		schema: never[]
	}
	create(context: Rule.RuleContext): Rule.RuleListener
} = {
	meta: {
		type: `problem`,
		docs: {
			description: `Require component files to export only their own component`,
			recommended: true,
			url: ``,
		},
		messages: {
			exportOwnComponentOnly: `Expected this .tsx file to export only the named component \`{{expectedExportName}}\`.`,
		},
		schema: [],
	},

	create(context) {
		const expectedExportName = getExpectedExportName(context.filename)

		return {
			ExportDefaultDeclaration(node) {
				context.report({
					node: getDefaultExportNameNode(node) ?? node,
					messageId: MESSAGE_ID,
					data: { expectedExportName },
				})
			},

			ExportNamedDeclaration(node: ExportNamedDeclaration) {
				if (isTypeOnlyExport(node)) return

				if (node.declaration) {
					const declarationNameNodes = getDeclarationNameNodes(node.declaration)
					const namesToReport =
						declarationNameNodes.length > 0 ? declarationNameNodes : [node]

					for (const nameNode of namesToReport) {
						if (
							nameNode.type === `Identifier` &&
							nameNode.name === expectedExportName
						) {
							continue
						}

						context.report({
							node: nameNode,
							messageId: MESSAGE_ID,
							data: { expectedExportName },
						})
					}

					return
				}

				for (const specifier of node.specifiers as ExportSpecifier[]) {
					if (specifier.exportKind === `type`) continue

					const exportedName =
						specifier.exported.type === `Identifier`
							? specifier.exported.name
							: specifier.exported.value

					if (exportedName !== expectedExportName) {
						context.report({
							node: specifier.exported,
							messageId: MESSAGE_ID,
							data: { expectedExportName },
						})
					}
				}
			},
		}
	},
} satisfies Rule.RuleModule
