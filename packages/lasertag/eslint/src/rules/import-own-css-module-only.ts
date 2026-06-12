import type { RuleType } from "@eslint/core"
import type { Rule } from "eslint"
import type * as ESTree from "estree"
import path from "node:path"

const MESSAGE_ID = `importOwnCssModule`

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
		messages: {
			importOwnCssModule: string
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
		messages: {
			importOwnCssModule: `Expected CSS module import to be "{{expectedImport}}".`,
		},
		schema: [],
	},

	create(context) {
		const expectedImport = getExpectedCssModuleImport(context.filename)

		return {
			ImportDeclaration(node) {
				if (!isCssModuleSource(node.source)) return

				if (node.source.value !== expectedImport) {
					context.report({
						node: node.source,
						messageId: MESSAGE_ID,
						data: { expectedImport },
					})
				}
			},
		}
	},
} satisfies Rule.RuleModule
