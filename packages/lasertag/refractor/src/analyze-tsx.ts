import path from "node:path"
import ts from "typescript"

import type {
	OpaqueStoryNode,
	RenderStory,
	RenderStoryWarning,
	SourceRange,
	StoryAttribute,
	StoryChild,
	StoryNode,
} from "./diagnostics.ts"

export type AnalyzeTsxOptions = {
	sourceText: string
	filePath?: string
	componentName?: string
	maxComponentDepth?: number
}

export type AnalyzeTsxRenderStoriesOptions = Omit<
	AnalyzeTsxOptions,
	"componentName"
> & {
	componentNames?: string[]
}

type ComponentDefinition = {
	name: string
	body: ts.ConciseBody
	range: SourceRange
}

type ComponentIndex = {
	components: Map<string, ComponentDefinition>
	exportedNames: Set<string>
	defaultExportName?: string
}

type AnalyzeContext = {
	sourceFile: ts.SourceFile
	components: Map<string, ComponentDefinition>
	warnings: RenderStoryWarning[]
	maxComponentDepth: number
}

const DEFAULT_MAX_COMPONENT_DEPTH = 25

function rangeOf(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
	return {
		start: node.getStart(sourceFile),
		end: node.getEnd(),
	}
}

function opaque(
	reason: string,
	sourceFile: ts.SourceFile,
	node: ts.Node,
): OpaqueStoryNode {
	return { kind: `opaque`, reason, range: rangeOf(sourceFile, node) }
}

function hasModifier(
	node: ts.Node,
	kind: ts.SyntaxKind.ExportKeyword | ts.SyntaxKind.DefaultKeyword,
): boolean {
	return (
		ts.canHaveModifiers(node) &&
		ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
	)
}

function isComponentName(name: string): boolean {
	return /^[A-Z]/.test(name)
}

function containsJsx(node: ts.Node): boolean {
	let foundJsx = false

	function visit(child: ts.Node): void {
		if (foundJsx) return

		if (
			ts.isJsxElement(child) ||
			ts.isJsxSelfClosingElement(child) ||
			ts.isJsxFragment(child)
		) {
			foundJsx = true
			return
		}

		ts.forEachChild(child, visit)
	}

	visit(node)

	return foundJsx
}

function isFunctionExpression(
	node: ts.Expression,
): node is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function functionBodyFromExpression(
	expression: ts.Expression,
): ts.ConciseBody | undefined {
	if (isFunctionExpression(expression)) {
		return expression.body
	}

	if (
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isParenthesizedExpression(expression) ||
		ts.isTypeAssertionExpression(expression)
	) {
		return functionBodyFromExpression(expression.expression)
	}

	if (ts.isCallExpression(expression)) {
		for (const argument of expression.arguments) {
			if (!ts.isExpression(argument)) continue

			const body = functionBodyFromExpression(argument)

			if (body) return body
		}
	}
}

function addVariableComponents(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	statement: ts.VariableStatement,
) {
	const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)

	for (const declaration of statement.declarationList.declarations) {
		if (!ts.isIdentifier(declaration.name)) continue
		if (!declaration.initializer) continue

		const body = functionBodyFromExpression(declaration.initializer)

		if (!body) continue

		const name = declaration.name.text

		index.components.set(name, {
			name,
			body,
			range: rangeOf(sourceFile, declaration),
		})

		if (isExported) {
			index.exportedNames.add(name)
		}
	}
}

function addFunctionComponent(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	statement: ts.FunctionDeclaration,
) {
	if (!statement.name || !statement.body) return

	const name = statement.name.text

	index.components.set(name, {
		name,
		body: statement.body,
		range: rangeOf(sourceFile, statement),
	})

	if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
		index.exportedNames.add(name)
	}

	if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
		index.defaultExportName = name
	}
}

function addExportDeclaration(
	index: ComponentIndex,
	statement: ts.ExportDeclaration,
) {
	const exportClause = statement.exportClause

	if (!exportClause || !ts.isNamedExports(exportClause)) return

	for (const element of exportClause.elements) {
		index.exportedNames.add((element.propertyName ?? element.name).text)
	}
}

function addExportAssignment(
	index: ComponentIndex,
	statement: ts.ExportAssignment,
) {
	if (!ts.isIdentifier(statement.expression)) return

	index.defaultExportName = statement.expression.text
	index.exportedNames.add(statement.expression.text)
}

function collectComponentIndex(sourceFile: ts.SourceFile): ComponentIndex {
	const index: ComponentIndex = {
		components: new Map(),
		exportedNames: new Set(),
	}

	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			addFunctionComponent(sourceFile, index, statement)
			continue
		}

		if (ts.isVariableStatement(statement)) {
			addVariableComponents(sourceFile, index, statement)
			continue
		}

		if (ts.isExportDeclaration(statement)) {
			addExportDeclaration(index, statement)
			continue
		}

		if (ts.isExportAssignment(statement)) {
			addExportAssignment(index, statement)
		}
	}

	return index
}

function toPascalishStem(filePath: string | undefined): string | undefined {
	if (!filePath) return

	const { name } = path.parse(filePath)

	return name
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(``)
}

function selectMainComponent(
	index: ComponentIndex,
	options: AnalyzeTsxOptions,
	warnings: RenderStoryWarning[],
): string | undefined {
	if (options.componentName) {
		return index.components.has(options.componentName)
			? options.componentName
			: undefined
	}

	const fileStemName = toPascalishStem(options.filePath)

	if (fileStemName && index.exportedNames.has(fileStemName)) {
		return fileStemName
	}

	if (
		index.defaultExportName &&
		index.components.has(index.defaultExportName)
	) {
		return index.defaultExportName
	}

	const exportedComponentNames = [...index.exportedNames].filter((name) =>
		index.components.has(name),
	)

	if (exportedComponentNames.length === 1) {
		return exportedComponentNames[0]
	}

	if (exportedComponentNames.length > 1) {
		warnings.push({
			code: `multiple-main-components`,
			message: `Found multiple exported components; pass componentName to choose one.`,
		})
	}
}

function selectComponentStories(
	index: ComponentIndex,
	options: AnalyzeTsxRenderStoriesOptions,
): string[] {
	const candidateNames =
		options.componentNames ??
		[...index.components]
			.filter(
				([componentName, definition]) =>
					isComponentName(componentName) && containsJsx(definition.body),
			)
			.map(([componentName]) => componentName)
	const names = candidateNames
		.filter((componentName) => index.components.has(componentName))
		.toSorted((leftName, rightName) => {
			const left = index.components.get(leftName)
			const right = index.components.get(rightName)

			return (left?.range.start ?? 0) - (right?.range.start ?? 0)
		})

	return [...new Set(names)]
}

function collectReturnedExpressions(
	sourceFile: ts.SourceFile,
	block: ts.Block,
): Array<ts.Expression | undefined> {
	const returnedExpressions: Array<ts.Expression | undefined> = []

	function visit(node: ts.Node) {
		if (ts.isReturnStatement(node)) {
			returnedExpressions.push(node.expression)
			return
		}

		if (node !== block && ts.isFunctionLike(node)) return

		ts.forEachChild(node, visit)
	}

	for (const statement of block.statements) {
		visit(statement)
	}

	return returnedExpressions
}

function analyzeComponent(
	context: AnalyzeContext,
	componentName: string,
	stack: string[],
): StoryChild[] {
	const definition = context.components.get(componentName)

	if (!definition) {
		context.warnings.push({
			code: `component-not-found`,
			message: `Could not find component ${componentName}.`,
		})

		return []
	}

	if (stack.includes(componentName)) {
		context.warnings.push({
			code: `component-cycle`,
			message: `Stopped expanding recursive component ${componentName}.`,
			range: definition.range,
		})

		return [
			{
				kind: `opaque`,
				reason: `recursive local component`,
				range: definition.range,
			},
		]
	}

	if (stack.length >= context.maxComponentDepth) {
		return [
			{
				kind: `opaque`,
				reason: `component expansion depth limit`,
				range: definition.range,
			},
		]
	}

	return analyzeFunctionBody(context, definition.body, [
		...stack,
		componentName,
	])
}

function analyzeFunctionBody(
	context: AnalyzeContext,
	body: ts.ConciseBody,
	stack: string[],
): StoryChild[] {
	if (!ts.isBlock(body)) {
		return analyzeExpression(context, body, stack)
	}

	const returnedExpressions = collectReturnedExpressions(
		context.sourceFile,
		body,
	)

	if (returnedExpressions.length === 0) {
		return [
			opaque(`function body without a JSX return`, context.sourceFile, body),
		]
	}

	return returnedExpressions.flatMap((expression) =>
		expression
			? analyzeExpression(context, expression, stack)
			: [opaque(`empty return statement`, context.sourceFile, body)],
	)
}

function getJsxTagText(
	sourceFile: ts.SourceFile,
	name: ts.JsxTagNameExpression,
): string {
	return name.getText(sourceFile)
}

function normalizeJsxAttributeName(name: string): string {
	switch (name) {
		case `className`:
			return `class`
		case `htmlFor`:
			return `for`
		default:
			return name
	}
}

function stringLiteralAttributeValue(
	sourceFile: ts.SourceFile,
	initializer: ts.JsxAttribute[`initializer`],
): Pick<StoryAttribute, `value` | `valueRange`> {
	if (!initializer) return {}

	if (ts.isStringLiteral(initializer)) {
		return {
			value: initializer.text,
			valueRange: rangeOf(sourceFile, initializer),
		}
	}

	if (
		ts.isJsxExpression(initializer) &&
		initializer.expression &&
		ts.isStringLiteralLike(initializer.expression)
	) {
		return {
			value: initializer.expression.text,
			valueRange: rangeOf(sourceFile, initializer.expression),
		}
	}

	return {}
}

function analyzeJsxAttributes(
	context: AnalyzeContext,
	attributes: ts.JsxAttributes,
): StoryAttribute[] {
	return attributes.properties.flatMap((attribute) => {
		if (ts.isJsxSpreadAttribute(attribute)) return []

		const name = normalizeJsxAttributeName(
			attribute.name.getText(context.sourceFile),
		)

		if (name === `key` || name === `ref`) return []

		return [
			{
				name,
				range: rangeOf(context.sourceFile, attribute),
				...stringLiteralAttributeValue(
					context.sourceFile,
					attribute.initializer,
				),
			},
		]
	})
}

function createStoryNode(
	context: AnalyzeContext,
	tagName: string,
	children: StoryChild[],
	range: SourceRange,
	attributes: ts.JsxAttributes,
): StoryNode {
	const storyAttributes = analyzeJsxAttributes(context, attributes)
	const baseNode: StoryNode = {
		kind: `element`,
		tagName,
		children,
		range,
	}

	return storyAttributes.length > 0
		? { ...baseNode, attributes: storyAttributes }
		: baseNode
}

function isIntrinsicJsxTag(tagName: string): boolean {
	return /^[a-z]/.test(tagName) || tagName.includes(`-`)
}

function isFragmentJsxTag(tagName: string): boolean {
	return tagName === `Fragment` || tagName === `React.Fragment`
}

function analyzeJsxElement(
	context: AnalyzeContext,
	node: ts.JsxElement,
	stack: string[],
): StoryChild[] {
	const tagName = getJsxTagText(context.sourceFile, node.openingElement.tagName)

	if (isFragmentJsxTag(tagName)) {
		return analyzeJsxChildren(context, node.children, stack)
	}

	if (!isIntrinsicJsxTag(tagName)) {
		return analyzeComponentTag(context, tagName, node, stack)
	}

	return [
		createStoryNode(
			context,
			tagName,
			analyzeJsxChildren(context, node.children, stack),
			rangeOf(context.sourceFile, node.openingElement.tagName),
			node.openingElement.attributes,
		),
	]
}

function analyzeJsxSelfClosingElement(
	context: AnalyzeContext,
	node: ts.JsxSelfClosingElement,
	stack: string[],
): StoryChild[] {
	const tagName = getJsxTagText(context.sourceFile, node.tagName)

	if (isFragmentJsxTag(tagName)) {
		return []
	}

	if (!isIntrinsicJsxTag(tagName)) {
		return analyzeComponentTag(context, tagName, node, stack)
	}

	return [
		createStoryNode(
			context,
			tagName,
			[],
			rangeOf(context.sourceFile, node.tagName),
			node.attributes,
		),
	]
}

function analyzeComponentTag(
	context: AnalyzeContext,
	tagName: string,
	node: ts.Node,
	stack: string[],
): StoryChild[] {
	if (!isComponentName(tagName) || tagName.includes(`.`)) {
		return [opaque(`dynamic JSX component`, context.sourceFile, node)]
	}

	if (!context.components.has(tagName)) {
		return [opaque(`imported or external component`, context.sourceFile, node)]
	}

	return analyzeComponent(context, tagName, stack)
}

function analyzeJsxChildren(
	context: AnalyzeContext,
	children: ts.NodeArray<ts.JsxChild>,
	stack: string[],
): StoryChild[] {
	return children.flatMap((child) => {
		if (ts.isJsxText(child)) return []

		if (ts.isJsxExpression(child)) {
			return child.expression
				? analyzeExpression(context, child.expression, stack)
				: []
		}

		if (ts.isJsxElement(child)) {
			return analyzeJsxElement(context, child, stack)
		}

		if (ts.isJsxSelfClosingElement(child)) {
			return analyzeJsxSelfClosingElement(context, child, stack)
		}

		if (ts.isJsxFragment(child)) {
			return analyzeJsxChildren(context, child.children, stack)
		}

		return [opaque(`unsupported JSX child`, context.sourceFile, child)]
	})
}

function isChildrenExpression(expression: ts.Expression): boolean {
	if (ts.isIdentifier(expression)) {
		return expression.text === `children`
	}

	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text === `children`
	}

	if (!ts.isElementAccessExpression(expression)) {
		return false
	}

	const argumentExpression = expression.argumentExpression

	return (
		ts.isStringLiteralLike(argumentExpression) &&
		argumentExpression.text === `children`
	)
}

function analyzeMapCall(
	context: AnalyzeContext,
	node: ts.CallExpression,
	stack: string[],
): StoryChild[] | undefined {
	if (!ts.isPropertyAccessExpression(node.expression)) return
	if (node.expression.name.text !== `map`) return

	const callback = node.arguments[0]

	if (!callback)
		return [opaque(`map call without callback`, context.sourceFile, node)]

	if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
		return [
			opaque(`map call without inline callback`, context.sourceFile, node),
		]
	}

	return analyzeFunctionBody(context, callback.body, stack)
}

function analyzeExpression(
	context: AnalyzeContext,
	expression: ts.Expression,
	stack: string[],
): StoryChild[] {
	if (ts.isParenthesizedExpression(expression)) {
		return analyzeExpression(context, expression.expression, stack)
	}

	if (
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isTypeAssertionExpression(expression)
	) {
		return analyzeExpression(context, expression.expression, stack)
	}

	if (ts.isJsxElement(expression)) {
		return analyzeJsxElement(context, expression, stack)
	}

	if (ts.isJsxSelfClosingElement(expression)) {
		return analyzeJsxSelfClosingElement(context, expression, stack)
	}

	if (ts.isJsxFragment(expression)) {
		return analyzeJsxChildren(context, expression.children, stack)
	}

	if (ts.isConditionalExpression(expression)) {
		return [
			...analyzeExpression(context, expression.whenTrue, stack),
			...analyzeExpression(context, expression.whenFalse, stack),
		]
	}

	if (ts.isBinaryExpression(expression)) {
		if (
			expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
		) {
			return analyzeExpression(context, expression.right, stack)
		}

		if (
			expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
			expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
		) {
			return [
				...analyzeExpression(context, expression.left, stack),
				...analyzeExpression(context, expression.right, stack),
			]
		}
	}

	if (ts.isArrayLiteralExpression(expression)) {
		return expression.elements.flatMap((element) =>
			ts.isSpreadElement(element)
				? [opaque(`spread array render branch`, context.sourceFile, element)]
				: analyzeExpression(context, element, stack),
		)
	}

	if (ts.isCallExpression(expression)) {
		return (
			analyzeMapCall(context, expression, stack) ?? [
				opaque(`unsupported render call`, context.sourceFile, expression),
			]
		)
	}

	if (expression.kind === ts.SyntaxKind.NullKeyword) return []
	if (expression.kind === ts.SyntaxKind.FalseKeyword) return []

	if (isChildrenExpression(expression)) {
		return [
			opaque(`children prop render branch`, context.sourceFile, expression),
		]
	}

	if (
		ts.isIdentifier(expression) &&
		(expression.text === `undefined` || expression.text === `Fragment`)
	) {
		return []
	}

	return [
		opaque(`unsupported render expression`, context.sourceFile, expression),
	]
}

function createSourceFile(options: AnalyzeTsxOptions): ts.SourceFile {
	return ts.createSourceFile(
		options.filePath ?? `component.tsx`,
		options.sourceText,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	)
}

function createAnalyzeContext(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	warnings: RenderStoryWarning[],
	options: Pick<AnalyzeTsxOptions, "maxComponentDepth">,
): AnalyzeContext {
	return {
		sourceFile,
		components: index.components,
		warnings,
		maxComponentDepth: options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH,
	}
}

function analyzeIndexedComponent(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	componentName: string,
	options: Pick<AnalyzeTsxOptions, "maxComponentDepth">,
): RenderStory {
	const warnings: RenderStoryWarning[] = []
	const context = createAnalyzeContext(sourceFile, index, warnings, options)

	return {
		componentName,
		roots: analyzeComponent(context, componentName, []),
		warnings,
	}
}

export function analyzeTsxRenderStory(options: AnalyzeTsxOptions): RenderStory {
	const sourceFile = createSourceFile(options)
	const index = collectComponentIndex(sourceFile)
	const warnings: RenderStoryWarning[] = []
	const componentName = selectMainComponent(index, options, warnings)

	if (!componentName) {
		return {
			componentName: options.componentName ?? `unknown`,
			roots: [opaque(`main component not found`, sourceFile, sourceFile)],
			warnings,
		}
	}

	const context = createAnalyzeContext(sourceFile, index, warnings, options)

	return {
		componentName,
		roots: analyzeComponent(context, componentName, []),
		warnings,
	}
}

export function analyzeTsxRenderStories(
	options: AnalyzeTsxRenderStoriesOptions,
): RenderStory[] {
	const sourceFile = createSourceFile(options)
	const index = collectComponentIndex(sourceFile)

	return selectComponentStories(index, options).map((componentName) =>
		analyzeIndexedComponent(sourceFile, index, componentName, options),
	)
}
