import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule } from "eslint"
import type * as ESTree from "estree"

const MESSAGE_ID = `renderTagWithOwnName`

type RuleOptions = [
	{
		checkAllComponentFunctions?: boolean
	}?,
]

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

function getJSXElementNameNode(
	node: JSSyntaxElement | undefined,
): JSSyntaxElement | undefined {
	if (node?.type !== `JSXElement`) return

	const element = node as JSXElement
	const { name } = element.openingElement

	return isJSXIdentifier(name) ? name : undefined
}

function isFunctionNode(node: JSSyntaxElement): boolean {
	return (
		node.type === `ArrowFunctionExpression` ||
		node.type === `FunctionDeclaration` ||
		node.type === `FunctionExpression`
	)
}

function getNodeChildren(node: JSSyntaxElement): JSSyntaxElement[] {
	const children: JSSyntaxElement[] = []

	for (const [key, value] of Object.entries(node)) {
		if (key === `parent`) continue

		if (Array.isArray(value)) {
			children.push(
				...value.filter(
					(child): child is JSSyntaxElement =>
						child !== null &&
						typeof child === `object` &&
						`type` in child &&
						typeof child.type === `string`,
				),
			)
			continue
		}

		if (
			value !== null &&
			typeof value === `object` &&
			`type` in value &&
			typeof value.type === `string`
		) {
			children.push(value as JSSyntaxElement)
		}
	}

	return children
}

function collectReturnedNodes(
	node: JSSyntaxElement,
	returnedNodes: Array<JSSyntaxElement | undefined>,
	visitedNodes: WeakSet<object>,
) {
	if (visitedNodes.has(node)) return

	visitedNodes.add(node)

	if (node.type === `ReturnStatement`) {
		const returnStatement = node as ReturnStatement

		returnedNodes.push(
			(returnStatement.argument as JSSyntaxElement | null) ?? undefined,
		)
		return
	}

	if (isFunctionNode(node)) return

	for (const child of getNodeChildren(node)) {
		collectReturnedNodes(child, returnedNodes, visitedNodes)
	}
}

function findReturnedNodes(
	node: JSSyntaxElement,
): Array<JSSyntaxElement | undefined> {
	if (node.type !== `BlockStatement`) return [node]

	const blockStatement = node as ESTree.BlockStatement
	const returnedNodes: Array<JSSyntaxElement | undefined> = []
	const visitedNodes = new WeakSet<object>()

	for (const statement of blockStatement.body) {
		collectReturnedNodes(
			statement as JSSyntaxElement,
			returnedNodes,
			visitedNodes,
		)
	}

	return returnedNodes
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

function getVariableDeclaratorComponentBody(
	declarator: ESTree.VariableDeclarator,
): { componentName: string; body: JSSyntaxElement } | undefined {
	if (declarator.id.type !== `Identifier`) return
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

function isPascalCase(name: string): boolean {
	return /^[A-Z][A-Za-z0-9]*$/.test(name)
}

function isAllowedRootTag(componentName: string, tagName: string | undefined) {
	return tagName === toKebabCase(componentName)
}

function reportIfRootTagsDoNotMatch(
	context: Rule.RuleContext,
	componentName: string,
	rootNodes: Array<JSSyntaxElement | undefined>,
) {
	const nodesToCheck = rootNodes.length > 0 ? rootNodes : [undefined]

	for (const rootNode of nodesToCheck) {
		const rootTagName = rootNode ? getJSXElementName(rootNode) : undefined
		const expectedTagName = toKebabCase(componentName)

		if (!isAllowedRootTag(componentName, rootTagName)) {
			context.report({
				node:
					getJSXElementNameNode(rootNode) ?? rootNode ?? context.sourceCode.ast,
				messageId: MESSAGE_ID,
				data: { componentName, expectedTagName },
			})
		}
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
		messages: {
			renderTagWithOwnName: string
		}
		schema: NonNullable<Rule.RuleMetaData["schema"]>
	}
	create(context: Rule.RuleContext): Rule.RuleListener
} = {
	meta: {
		type: `problem`,
		docs: {
			description: `Require component functions to render a root tag matching the component name`,
			recommended: true,
			url: ``,
		},
		messages: {
			renderTagWithOwnName: `Expected component function \`{{componentName}}\` to return JSX with outermost tag <{{expectedTagName}}>.`,
		},
		schema: [
			{
				type: `object`,
				additionalProperties: false,
				properties: {
					checkAllComponentFunctions: {
						type: `boolean`,
					},
				},
			},
		],
	},

	create(context) {
		const [{ checkAllComponentFunctions = false } = {}] =
			context.options as RuleOptions

		const checkComponent = (componentName: string, body: JSSyntaxElement) => {
			reportIfRootTagsDoNotMatch(
				context,
				componentName,
				findReturnedNodes(body),
			)
		}

		if (checkAllComponentFunctions) {
			return {
				FunctionDeclaration(node) {
					if (!node.id || !isPascalCase(node.id.name)) return

					checkComponent(node.id.name, node.body as unknown as JSSyntaxElement)
				},

				VariableDeclarator(node) {
					const component = getVariableDeclaratorComponentBody(node)

					if (!component || !isPascalCase(component.componentName)) return

					checkComponent(component.componentName, component.body)
				},
			}
		}

		return {
			ExportNamedDeclaration(node) {
				const { declaration } = node

				if (!declaration) return

				if (declaration.type === `FunctionDeclaration`) {
					if (!declaration.id) return

					checkComponent(
						declaration.id.name,
						declaration.body as JSSyntaxElement,
					)
					return
				}

				if (declaration.type === `VariableDeclaration`) {
					const component = getVariableComponentBody(declaration)

					if (!component) return

					checkComponent(component.componentName, component.body)
				}
			},
		}
	},
} satisfies Rule.RuleModule
