import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule } from "eslint"

const GROUP_TAGS = new Set([`header`, `main`, `footer`])
const MESSAGE = `Use <header>, <main>, and <footer> only as a sibling group of two or more, with no unrelated element siblings.`

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
	children?: JSSyntaxElement[]
	parent?: JSSyntaxElement
}

function getJSXElementName(node: JSSyntaxElement): string | undefined {
	if (node.type !== `JSXElement`) return

	const element = node as JSXElement
	const { name } = element.openingElement

	return isJSXIdentifier(name) ? name.name : undefined
}

function isGroupTagName(name: string | undefined): boolean {
	return name !== undefined && GROUP_TAGS.has(name)
}

function isJSXIdentifier(node: JSSyntaxElement): node is JSXIdentifier {
	return node.type === `JSXIdentifier`
}

export const headerMainFooterAsGroup: {
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
			description: `Require header, main, and footer elements to appear only as a sibling group without unrelated element siblings`,
			recommended: true,
			url: ``,
		},
		schema: [],
	},

	create(context) {
		return {
			JSXElement(node: JSSyntaxElement) {
				const tagName = getJSXElementName(node)

				if (!isGroupTagName(tagName)) return

				const element = node as JSXElement
				const parent = element.parent as JSXElement | undefined

				if (parent?.type !== `JSXElement`) {
					context.report({ node, message: MESSAGE })
					return
				}

				const elementSiblings =
					parent.children?.filter(
						(child): child is JSXElement => child.type === `JSXElement`,
					) ?? []
				const siblingNames = elementSiblings.map(getJSXElementName)
				const groupSiblingCount = siblingNames.filter(isGroupTagName).length
				const hasUnrelatedElementSibling = siblingNames.some(
					(name) => !isGroupTagName(name),
				)

				if (groupSiblingCount < 2 || hasUnrelatedElementSibling) {
					context.report({ node, message: MESSAGE })
				}
			},
		}
	},
} satisfies Rule.RuleModule
