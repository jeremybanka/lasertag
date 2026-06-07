import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"
import path from "node:path"

const MESSAGE = `Import only the CSS module that belongs to this component file.`

function isCssModuleSource(
	source: ESTree.Literal,
): source is ESTree.Literal & { value: string } {
	return (
		typeof source.value === `string` && source.value.endsWith(`.module.css`)
	)
}

function getExpectedCssModuleImport(filename: string): string {
	const parsedPath = path.parse(filename)

	return `./${parsedPath.name}.module.css`
}

export const importOwnCssModuleOnly: {
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
			description: `Require component files to import only their own sibling CSS module`,
			recommended: true,
			url: ``,
		},
		schema: [],
	},

	create(context) {
		return {
			ImportDeclaration(node) {
				if (!isCssModuleSource(node.source)) return

				if (
					node.source.value !== getExpectedCssModuleImport(context.filename)
				) {
					context.report({ node: node.source, message: MESSAGE })
				}
			},
		}
	},
} satisfies Rule.RuleModule
