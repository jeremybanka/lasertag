import type { RuleType } from "@eslint/core"
import type { JSSyntaxElement, Rule } from "eslint"

import {
	createComponentRootListener,
	getJSXElementName,
	getJSXElementNameNode,
	toKebabCase,
} from "../component-roots.ts"

const MESSAGE_ID = `renderTagWithOwnName`

type RuleOptions = [
	{
		checkAllComponentFunctions?: boolean
	}?,
]

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

		return createComponentRootListener(
			checkAllComponentFunctions,
			(componentName, rootNodes) => {
				reportIfRootTagsDoNotMatch(context, componentName, rootNodes)
			},
		)
	},
} satisfies Rule.RuleModule
