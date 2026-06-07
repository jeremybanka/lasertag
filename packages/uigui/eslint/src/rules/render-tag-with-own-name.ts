import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule } from "eslint"
import type * as ESTree from "estree"

const FORM_CONTROL_ROOT_TAGS = new Set([
	`button`,
	`fieldset`,
	`form`,
	`input`,
	`label`,
	`select`,
	`textarea`,
])
const MESSAGE = `Exported components should render a root tag matching their own name, unless a native form control is the meaningful wrapper.`

type JSXIdentifier = JSSyntaxElement & {
	type: `JSXIdentifier`
	name: string
}

type JSXOpeningElement = JSSyntaxElement & {
	type: `JSXOpeningElement`
	name: JSXIdentifier | JSSyntaxElement
}

type JSXElement = JSSyntaxElement & {
	type: `JSXElement`
	openingElement: JSXOpeningElement
}

type ReturnStatement = ESTree.ReturnStatement & {
	argument: ESTree.Node | null
}

function toKebabCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, `$1-$2`)
		.replace(/([A-Z])([A-Z][a-z])/g, `$1-$2`)
		.toLowerCase()
}

function isJSXIdentifier(node: JSSyntaxElement): node is JSXIdentifier {
	return node.type === `JSXIdentifier`
}

function getJSXElementName(node: JSSyntaxElement): string | undefined {
	if (node.type !== `JSXElement`) return

	const element = node as JSXElement
	const { name } = element.openingElement

	return isJSXIdentifier(name) ? name.name : undefined
}

function findReturnedNode(node: JSSyntaxElement): JSSyntaxElement | undefined {
	if (node.type !== `BlockStatement`) return node

	const blockStatement = node as ESTree.BlockStatement
	const returnStatement = blockStatement.body.find(
		(statement): statement is ReturnStatement =>
			statement.type === `ReturnStatement`,
	)

	return (returnStatement?.argument as JSSyntaxElement | null) ?? undefined
}

function getVariableComponentBody(
	declaration: ESTree.VariableDeclaration,
): { componentName: string; body: JSSyntaxElement } | undefined {
	if (declaration.declarations.length !== 1) return

	const declarator = declaration.declarations[0]
	if (declarator?.id.type !== `Identifier`) return
	if (
		declarator.init?.type !== `ArrowFunctionExpression` &&
		declarator.init?.type !== `FunctionExpression`
	) {
		return
	}

	return {
		componentName: declarator.id.name,
		body: declarator.init.body as unknown as JSSyntaxElement,
	}
}

function isAllowedRootTag(componentName: string, tagName: string | undefined) {
	return (
		tagName === toKebabCase(componentName) ||
		(tagName !== undefined && FORM_CONTROL_ROOT_TAGS.has(tagName))
	)
}

function reportIfRootTagDoesNotMatch(
	context: Rule.RuleContext,
	componentName: string,
	rootNode: JSSyntaxElement | undefined,
) {
	const rootTagName = rootNode ? getJSXElementName(rootNode) : undefined

	if (!isAllowedRootTag(componentName, rootTagName)) {
		context.report({
			node: rootNode ?? context.sourceCode.ast,
			message: MESSAGE,
		})
	}
}

export const renderTagWithOwnName: {
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
			description: `Require exported components to render a root tag matching the component name`,
			recommended: true,
			url: ``,
		},
		schema: [],
	},

	create(context) {
		return {
			ExportNamedDeclaration(node) {
				const { declaration } = node

				if (!declaration) return

				if (declaration.type === `FunctionDeclaration`) {
					if (!declaration.id) return

					reportIfRootTagDoesNotMatch(
						context,
						declaration.id.name,
						findReturnedNode(declaration.body as JSSyntaxElement),
					)
					return
				}

				if (declaration.type === `VariableDeclaration`) {
					const component = getVariableComponentBody(declaration)

					if (!component) return

					reportIfRootTagDoesNotMatch(
						context,
						component.componentName,
						findReturnedNode(component.body),
					)
				}
			},
		}
	},
} satisfies Rule.RuleModule
