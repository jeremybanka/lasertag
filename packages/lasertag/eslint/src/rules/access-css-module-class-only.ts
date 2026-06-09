import type { RuleType } from "@eslint/core"
import type { Rule, Scope } from "eslint"
import type * as ESTree from "estree"

const MESSAGE = `Access only css.class from CSS module imports.`

function isCssModuleSource(source: ESTree.Literal): boolean {
	return (
		typeof source.value === `string` && source.value.endsWith(`.module.css`)
	)
}

function findVariable(
	scope: Scope.Scope | null,
	name: string,
): Scope.Variable | undefined {
	while (scope) {
		const variable = scope.set.get(name)

		if (variable) return variable

		scope = scope.upper
	}
}

function isCssModuleImportAccess(
	context: Rule.RuleContext,
	importedCssModuleVariables: Set<Scope.Variable>,
	node: ESTree.MemberExpression,
): boolean {
	if (node.object.type !== `Identifier`) return false

	const variable = findVariable(
		context.sourceCode.getScope(node),
		node.object.name,
	)

	return variable !== undefined && importedCssModuleVariables.has(variable)
}

function isAllowedCssModuleAccess(node: ESTree.MemberExpression): boolean {
	return (
		!node.computed &&
		node.property.type === `Identifier` &&
		node.property.name === `class`
	)
}

export const accessCssModuleClassOnly: {
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
			description: `Require CSS module imports to access only css.class`,
			recommended: true,
			url: ``,
		},
		schema: [],
	},

	create(context) {
		const importedCssModuleVariables = new Set<Scope.Variable>()

		return {
			ImportDeclaration(node) {
				if (!isCssModuleSource(node.source)) return

				for (const variable of context.sourceCode.getDeclaredVariables(node)) {
					importedCssModuleVariables.add(variable)
				}
			},
			MemberExpression(node) {
				if (
					!isCssModuleImportAccess(context, importedCssModuleVariables, node) ||
					isAllowedCssModuleAccess(node)
				) {
					return
				}

				context.report({ node: node.property, message: MESSAGE })
			},
		}
	},
} satisfies Rule.RuleModule
