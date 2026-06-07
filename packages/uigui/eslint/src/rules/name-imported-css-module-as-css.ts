import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"

const MESSAGE = `Import CSS modules with a default import named css.`

function isCssModuleSource(source: ESTree.Literal): boolean {
	return (
		typeof source.value === `string` && source.value.endsWith(`.module.css`)
	)
}

export const nameImportedCssModuleAsCss: {
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
			description: `Require CSS modules to be imported with a default import named css`,
			recommended: true,
			url: ``,
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
					context.report({ node, message: MESSAGE })
				}
			},
		}
	},
} satisfies Rule.RuleModule
