import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule, Scope } from "eslint"
import type * as ESTree from "estree"
import path from "node:path"

import {
	createComponentRootListener,
	getJSXElementName,
	getJSXElementNameNode,
	getNodeChildren,
	isJSXIdentifier,
	toKebabCase,
	type JSXAttribute,
	type JSXElement,
} from "../component-roots.ts"

function isCssModuleSource(source: ESTree.Literal): boolean {
	return (
		typeof source.value === `string` && source.value.endsWith(`.module.css`)
	)
}

function findCssModuleVariables(
	context: Rule.RuleContext,
): Set<Scope.Variable> {
	const variables = new Set<Scope.Variable>()

	for (const statement of context.sourceCode.ast.body) {
		if (
			statement.type !== `ImportDeclaration` ||
			!isCssModuleSource(statement.source)
		) {
			continue
		}

		for (const variable of context.sourceCode.getDeclaredVariables(statement)) {
			variables.add(variable)
		}
	}

	return variables
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

function isClassProperty(node: ESTree.MemberExpression): boolean {
	const { property } = node

	if (!node.computed) {
		return property.type === `Identifier` && property.name === `class`
	}

	return (
		(property.type === `Literal` && property.value === `class`) ||
		(property.type === `TemplateLiteral` &&
			property.expressions.length === 0 &&
			property.quasis[0]?.value.cooked === `class`)
	)
}

function usesCssModuleClass(
	context: Rule.RuleContext,
	cssModuleVariables: Set<Scope.Variable>,
	node: JSSyntaxElement,
): boolean {
	if (node.type === `MemberExpression`) {
		const member = node as ESTree.MemberExpression

		if (member.object.type === `Identifier` && isClassProperty(member)) {
			const variable = findVariable(
				context.sourceCode.getScope(member),
				member.object.name,
			)

			if (variable !== undefined && cssModuleVariables.has(variable)) {
				return true
			}
		}
	}

	return getNodeChildren(node).some((child) =>
		usesCssModuleClass(context, cssModuleVariables, child),
	)
}

function isClassAttribute(
	attribute: JSXAttribute | JSSyntaxElement,
): attribute is JSXAttribute {
	if (attribute.type !== `JSXAttribute`) return false

	const { name } = attribute as JSXAttribute

	return (
		isJSXIdentifier(name) &&
		(name.name === `class` || name.name === `className`)
	)
}

export const attachCssClassToOwnTag: {
	meta: {
		type: RuleType
		docs: {
			description: string
			recommended: boolean
			url: string
		}
		messages: {
			attachCssClassToOwnTag: string
			importAndAttachCssClassToOwnTag: string
		}
		schema: never[]
	}
	create(context: Rule.RuleContext): Rule.RuleListener
} = {
	meta: {
		type: `problem`,
		docs: {
			description: `Require an exported component's own-name root tag to carry its CSS module class`,
			recommended: true,
			url: ``,
		},
		messages: {
			attachCssClassToOwnTag: `Expected <{{tagName}}> to carry this component's CSS module class: \`class={css.class}\` or \`className={css.class}\`.`,
			importAndAttachCssClassToOwnTag: `Expected <{{tagName}}> to carry this component's CSS module class: \`import css from "{{expectedImport}}"\`, then \`class={css.class}\` or \`className={css.class}\`.`,
		},
		schema: [],
	},

	create(context) {
		const cssModuleVariables = findCssModuleVariables(context)
		const expectedImport = `./${path.parse(context.filename).name}.module.css`

		return createComponentRootListener(false, (componentName, rootNodes) => {
			const tagName = toKebabCase(componentName)

			for (const rootNode of rootNodes) {
				// Any other root is `render-tag-with-own-name`'s finding.
				if (!rootNode || getJSXElementName(rootNode) !== tagName) continue

				const { attributes } = (rootNode as JSXElement).openingElement
				const isAttached = attributes.some(
					(attribute) =>
						isClassAttribute(attribute) &&
						attribute.value !== null &&
						usesCssModuleClass(context, cssModuleVariables, attribute.value),
				)

				if (isAttached) continue

				context.report({
					node: getJSXElementNameNode(rootNode) ?? rootNode,
					messageId:
						cssModuleVariables.size === 0
							? `importAndAttachCssClassToOwnTag`
							: `attachCssClassToOwnTag`,
					data: { tagName, expectedImport },
				})
			}
		})
	},
} satisfies Rule.RuleModule
