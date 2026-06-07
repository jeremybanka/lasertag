import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule } from "eslint"

type JSXIdentifier = JSSyntaxElement & {
	type: `JSXIdentifier`
	name: string
}

type JSXOpeningElement = JSSyntaxElement & {
	type: `JSXOpeningElement`
	name: JSXIdentifier | JSSyntaxElement
}

function isJSXIdentifier(node: JSSyntaxElement): node is JSXIdentifier {
	return node.type === `JSXIdentifier`
}

export const banDiv: {
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
			description: `Disallow div elements so UI structure uses semantic HTML, form controls, or descriptive custom elements`,
			recommended: true,
			url: ``,
		},
		schema: [],
	},

	create(context) {
		return {
			JSXOpeningElement(node: JSSyntaxElement) {
				const jsxNode = node as JSXOpeningElement

				if (!isJSXIdentifier(jsxNode.name) || jsxNode.name.name !== `div`) {
					return
				}

				context.report({
					node: jsxNode.name,
					message: `Do not use <div>. Use semantic HTML, a form control, or a descriptive custom element instead.`,
				})
			},
		}
	},
} satisfies Rule.RuleModule
