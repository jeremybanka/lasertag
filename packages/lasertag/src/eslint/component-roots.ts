import type { JSSyntaxElement, Rule } from "eslint"
import type * as ESTree from "estree"

export type JSXIdentifier = JSSyntaxElement & {
	type: `JSXIdentifier`
	name: string
}

export type JSXAttribute = JSSyntaxElement & {
	type: `JSXAttribute`
	name: JSXIdentifier | JSSyntaxElement
	value: JSSyntaxElement | null
}

type JSXOpeningElement = JSSyntaxElement & {
	type: `JSXOpeningElement`
	name: JSXIdentifier | JSSyntaxElement
	attributes: Array<JSXAttribute | JSSyntaxElement>
}

export type JSXElement = JSSyntaxElement & {
	type: `JSXElement`
	openingElement: JSXOpeningElement
}

type ReturnStatement = ESTree.ReturnStatement & {
	argument: ESTree.Node | null
}

type CheckComponent = (
	componentName: string,
	rootNodes: Array<JSSyntaxElement | undefined>,
) => void

export function toKebabCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, `$1-$2`)
		.replace(/([A-Z])([A-Z][a-z])/g, `$1-$2`)
		.toLowerCase()
}

export function isJSXIdentifier(node: JSSyntaxElement): node is JSXIdentifier {
	return node.type === `JSXIdentifier`
}

export function getJSXElementName(node: JSSyntaxElement): string | undefined {
	if (node.type !== `JSXElement`) return

	const element = node as JSXElement
	const { name } = element.openingElement

	return isJSXIdentifier(name) ? name.name : undefined
}

export function getJSXElementNameNode(
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

export function getNodeChildren(node: JSSyntaxElement): JSSyntaxElement[] {
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

	return declarator ? getVariableDeclaratorComponentBody(declarator) : undefined
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

/**
 * Visits component functions and hands over the nodes each one returns.
 * By default only directly exported named declarations are components; with
 * `checkAllComponentFunctions`, every PascalCase function is.
 */
export function createComponentRootListener(
	checkAllComponentFunctions: boolean,
	checkComponent: CheckComponent,
): Rule.RuleListener {
	const checkBody = (componentName: string, body: JSSyntaxElement) => {
		checkComponent(componentName, findReturnedNodes(body))
	}

	if (checkAllComponentFunctions) {
		return {
			FunctionDeclaration(node) {
				if (!node.id || !isPascalCase(node.id.name)) return

				checkBody(node.id.name, node.body as unknown as JSSyntaxElement)
			},

			VariableDeclarator(node) {
				const component = getVariableDeclaratorComponentBody(node)

				if (!component || !isPascalCase(component.componentName)) return

				checkBody(component.componentName, component.body)
			},
		}
	}

	return {
		ExportNamedDeclaration(node) {
			const { declaration } = node

			if (!declaration) return

			if (declaration.type === `FunctionDeclaration`) {
				if (!declaration.id) return

				checkBody(declaration.id.name, declaration.body as JSSyntaxElement)
				return
			}

			if (declaration.type === `VariableDeclaration`) {
				const component = getVariableComponentBody(declaration)

				if (!component) return

				checkBody(component.componentName, component.body)
			}
		},
	}
}
