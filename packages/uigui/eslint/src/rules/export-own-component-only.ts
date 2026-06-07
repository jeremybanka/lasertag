import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"
import path from "node:path"

const MESSAGE = `Export only the component that belongs to this file.`

type ExportNamedDeclaration = ESTree.ExportNamedDeclaration & {
	exportKind?: `type` | `value`
}

type ExportSpecifier = ESTree.ExportSpecifier & {
	exportKind?: `type` | `value`
}

function getExpectedExportName(filename: string): string {
	return path.parse(filename).name
}

function getDeclarationName(
	declaration: ESTree.Declaration,
): string | undefined {
	switch (declaration.type) {
		case `FunctionDeclaration`:
		case `ClassDeclaration`:
			return declaration.id?.name
		case `VariableDeclaration`:
			if (declaration.declarations.length !== 1) return
			return declaration.declarations[0]?.id.type === `Identifier`
				? declaration.declarations[0].id.name
				: undefined
		default:
			return
	}
}

function isTypeOnlyExport(node: ExportNamedDeclaration): boolean {
	return node.exportKind === `type`
}

export const exportOwnComponentOnly: {
	meta: {
		type: RuleType
		docs: {
			description: string
			recommended: boolean
			url: string
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
		schema: [],
	},

	create(context) {
		const expectedExportName = getExpectedExportName(context.filename)

		return {
			ExportDefaultDeclaration(node) {
				context.report({ node, message: MESSAGE })
			},

			ExportNamedDeclaration(node: ExportNamedDeclaration) {
				if (isTypeOnlyExport(node)) return

				if (node.declaration) {
					const declarationName = getDeclarationName(node.declaration)

					if (declarationName !== expectedExportName) {
						context.report({ node, message: MESSAGE })
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
						context.report({ node: specifier, message: MESSAGE })
					}
				}
			},
		}
	},
} satisfies Rule.RuleModule
