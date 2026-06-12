import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"

const MESSAGE_ID = `nameImportedCssModuleAsCss`

function isCssModuleSource(
	source: ESTree.Literal,
): source is ESTree.Literal & { value: string } {
	return (
		typeof source.value === `string` && source.value.endsWith(`.module.css`)
	)
}

function getImportSpecifierNameNode(
	node: ESTree.ImportDeclaration,
): ESTree.Identifier | undefined {
	const defaultSpecifier = node.specifiers.find(
		(specifier) => specifier.type === `ImportDefaultSpecifier`,
	)

	if (defaultSpecifier && defaultSpecifier.local.name !== `css`) {
		return defaultSpecifier.local
	}

	return node.specifiers.find(
		(specifier) =>
			specifier.type === `ImportSpecifier` ||
			specifier.type === `ImportNamespaceSpecifier`,
	)?.local
}

export const nameImportedCssModuleAsCss: {
	meta: {
		type: RuleType
		docs: {
			description: string
			recommended: boolean
			url: string
		}
		messages: {
			nameImportedCssModuleAsCss: string
		}
		schema: never[]
	}
	create(context: Rule.RuleContext): Rule.RuleListener
} = {
	meta: {
		type: `problem`,
		docs: {
			description: `Require CSS modules to be imported with a default import named css`,
			recommended: true,
			url: ``,
		},
		messages: {
			nameImportedCssModuleAsCss: `Expected CSS module import to be \`import css from "{{source}}"\`.`,
		},
		schema: [],
	},

	create(context) {
		return {
			ImportDeclaration(node) {
				if (!isCssModuleSource(node.source)) return

				const hasOnlyCssDefaultImport =
					node.specifiers.length === 1 &&
					node.specifiers[0]?.type === `ImportDefaultSpecifier` &&
					node.specifiers[0].local.name === `css`

				if (!hasOnlyCssDefaultImport) {
					context.report({
						node: getImportSpecifierNameNode(node) ?? node,
						messageId: MESSAGE_ID,
						data: { source: node.source.value },
					})
				}
			},
		}
	},
} satisfies Rule.RuleModule
