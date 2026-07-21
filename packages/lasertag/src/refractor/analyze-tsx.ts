import path from "node:path"
import * as ts from "typescript/unstable/ast"

import type {
	OpaqueStoryNode,
	RenderStory,
	RenderStoryWarning,
	SourceRange,
	StoryAttribute,
	StoryChild,
	StoryChoiceNode,
	StoryNode,
} from "./diagnostics.ts"
import { scopeRenderStoryToCssClassRoots } from "./render-story-root.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstSession,
} from "./typescript-ast.ts"

export type AnalyzeTsxOptions = {
	sourceText: string
	filePath?: string
	componentName?: string
	maxComponentDepth?: number
	scopeToCssClassRoots?: boolean
	typescriptSdkPath?: string
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

type ImportBinding = {
	importedName: string
	moduleName: string
}

type ComponentIndex = {
	components: Map<string, ComponentDefinition>
	exportedNames: Set<string>
	imports: Map<string, ImportBinding>
	namespaceImports: Map<string, string>
	defaultExportName?: string
}

type AnalyzeContext = {
	sourceFile: ts.SourceFile
	components: Map<string, ComponentDefinition>
	imports: Map<string, ImportBinding>
	namespaceImports: Map<string, string>
	warnings: RenderStoryWarning[]
	maxComponentDepth: number
}

const DEFAULT_MAX_COMPONENT_DEPTH = 25

type NodeWithModifiers = ts.Node & {
	modifiers?: ts.NodeArray<ts.ModifierLike>
}

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

function foreignOpaque(
	reason: string,
	sourceFile: ts.SourceFile,
	node: ts.Node,
	expectedRootTagName?: string,
): OpaqueStoryNode {
	return {
		kind: `opaque`,
		reason,
		ownership: `foreign`,
		range: rangeOf(sourceFile, node),
		...(expectedRootTagName ? { expectedRootTagName } : {}),
	}
}

function toKebabCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, `$1-$2`)
		.replace(/([A-Z])([A-Z][a-z])/g, `$1-$2`)
		.toLowerCase()
}

function choice(
	alternatives: StoryChild[][],
	sourceFile: ts.SourceFile,
	node: ts.Node,
): StoryChoiceNode {
	return {
		alternatives,
		kind: `choice`,
		range: rangeOf(sourceFile, node),
	}
}

function hasModifier(
	node: ts.Node,
	kind: ts.SyntaxKind.ExportKeyword | ts.SyntaxKind.DefaultKeyword,
): boolean {
	const modifiers =
		`modifiers` in node ? (node as NodeWithModifiers).modifiers : undefined

	return modifiers?.some((modifier) => modifier.kind === kind) === true
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

		child.forEachChild(visit)
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
		ts.isTypeAssertion(expression)
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

function addImportDeclaration(
	index: ComponentIndex,
	statement: ts.ImportDeclaration,
) {
	if (!ts.isStringLiteralLikeNode(statement.moduleSpecifier)) return

	const importClause = statement.importClause

	if (!importClause) return

	const moduleName = statement.moduleSpecifier.text
	const namedBindings = importClause.namedBindings

	if (importClause.name) {
		index.imports.set(importClause.name.text, {
			importedName: `default`,
			moduleName,
		})
	}

	if (namedBindings && ts.isNamedImports(namedBindings)) {
		for (const element of namedBindings.elements) {
			if (element.isTypeOnly) continue

			index.imports.set(element.name.text, {
				importedName: (element.propertyName ?? element.name).text,
				moduleName,
			})
		}
	}

	if (namedBindings && ts.isNamespaceImport(namedBindings)) {
		index.namespaceImports.set(namedBindings.name.text, moduleName)
	}
}

function collectComponentIndex(sourceFile: ts.SourceFile): ComponentIndex {
	const index: ComponentIndex = {
		components: new Map(),
		exportedNames: new Set(),
		imports: new Map(),
		namespaceImports: new Map(),
	}

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			addImportDeclaration(index, statement)
			continue
		}

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

		if (node !== block && ts.isFunctionLikeDeclaration(node)) return

		node.forEachChild(visit)
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

	const alternatives = returnedExpressions.map((expression) =>
		expression
			? analyzeExpression(context, expression, stack)
			: [opaque(`empty return statement`, context.sourceFile, body)],
	)

	return alternatives.length === 1
		? (alternatives[0] ?? [])
		: [choice(alternatives, context.sourceFile, body)]
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

function analyzeJsxAttributeValue(
	sourceFile: ts.SourceFile,
	initializer: ts.JsxAttribute[`initializer`],
): Pick<StoryAttribute, `expression` | `value` | `valueRange`> {
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
		ts.isStringLiteralLikeNode(initializer.expression)
	) {
		return {
			value: initializer.expression.text,
			valueRange: rangeOf(sourceFile, initializer.expression),
		}
	}

	if (ts.isJsxExpression(initializer) && initializer.expression) {
		return {
			expression: initializer.expression.getText(sourceFile),
			valueRange: rangeOf(sourceFile, initializer.expression),
		}
	}

	return {}
}

function analyzeJsxAttributes(
	context: AnalyzeContext,
	attributes: ts.JsxAttributes,
	excludedNames: ReadonlySet<string> = new Set(),
): StoryAttribute[] {
	return attributes.properties.flatMap((attribute) => {
		if (ts.isJsxSpreadAttribute(attribute)) return []

		const name = normalizeJsxAttributeName(
			attribute.name.getText(context.sourceFile),
		)

		if (name === `key` || name === `ref` || excludedNames.has(name)) return []

		return [
			{
				name,
				range: rangeOf(context.sourceFile, attribute),
				...analyzeJsxAttributeValue(context.sourceFile, attribute.initializer),
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
	excludedAttributeNames?: ReadonlySet<string>,
): StoryNode {
	const storyAttributes = analyzeJsxAttributes(
		context,
		attributes,
		excludedAttributeNames,
	)
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

type ComponentJsxNode = ts.JsxElement | ts.JsxSelfClosingElement

function jsxAttributes(node: ComponentJsxNode): ts.JsxAttributes {
	return ts.isJsxElement(node)
		? node.openingElement.attributes
		: node.attributes
}

function jsxChildren(node: ComponentJsxNode): ts.NodeArray<ts.JsxChild> | [] {
	return ts.isJsxElement(node) ? node.children : []
}

function findJsxAttribute(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	name: string,
): ts.JsxAttribute | undefined {
	for (const attribute of jsxAttributes(node).properties) {
		if (ts.isJsxSpreadAttribute(attribute)) continue
		if (attribute.name.getText(context.sourceFile) === name) return attribute
	}
}

function resolveImportBinding(
	context: AnalyzeContext,
	tagName: string,
): ImportBinding | undefined {
	const directBinding = context.imports.get(tagName)

	if (directBinding) return directBinding

	const separatorIndex = tagName.indexOf(`.`)

	if (separatorIndex < 1 || tagName.indexOf(`.`, separatorIndex + 1) >= 0) {
		return
	}

	const namespaceName = tagName.slice(0, separatorIndex)
	const moduleName = context.namespaceImports.get(namespaceName)

	if (!moduleName) return

	return {
		importedName: tagName.slice(separatorIndex + 1),
		moduleName,
	}
}

function isImportedCall(
	context: AnalyzeContext,
	node: ts.CallExpression,
	moduleName: string,
	importedName: string,
): boolean {
	const binding = resolveImportBinding(
		context,
		node.expression.getText(context.sourceFile),
	)

	return (
		binding?.moduleName === moduleName && binding.importedName === importedName
	)
}

function expressionRootIdentifier(
	expression: ts.Expression,
): string | undefined {
	let current = expression

	while (
		ts.isPropertyAccessExpression(current) ||
		ts.isElementAccessExpression(current)
	) {
		current = current.expression
	}

	return ts.isIdentifier(current) ? current.text : undefined
}

function isRenderPropCall(node: ts.CallExpression): boolean {
	return expressionRootIdentifier(node.expression) === `props`
}

function analyzeJsxAttributeRenderValue(
	context: AnalyzeContext,
	attribute: ts.JsxAttribute,
	stack: string[],
): StoryChild[] {
	const initializer = attribute.initializer

	if (!initializer || ts.isStringLiteral(initializer)) return []

	if (ts.isJsxExpression(initializer)) {
		if (!initializer.expression) return []

		const functionBody = functionBodyFromExpression(initializer.expression)

		return functionBody
			? analyzeFunctionBody(context, functionBody, stack)
			: analyzeExpression(context, initializer.expression, stack)
	}

	return [
		opaque(
			`unsupported JSX attribute render branch`,
			context.sourceFile,
			initializer,
		),
	]
}

function analyzeSolidTransparentChildren(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] {
	return jsxChildren(node).flatMap((child) => {
		if (ts.isJsxExpression(child) && child.expression) {
			const functionBody = functionBodyFromExpression(child.expression)

			if (functionBody) return analyzeFunctionBody(context, functionBody, stack)
		}

		return analyzeJsxChild(context, child, stack)
	})
}

function analyzeSolidRepeatedChildren(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] {
	const children = jsxChildren(node)
	const meaningfulChildren = children.filter(
		(child) =>
			!ts.isJsxText(child) && !(ts.isJsxExpression(child) && !child.expression),
	)

	if (meaningfulChildren.length === 0) {
		return [
			opaque(`Solid loop without a render function`, context.sourceFile, node),
		]
	}

	return meaningfulChildren.flatMap((child) => {
		if (ts.isJsxExpression(child) && child.expression) {
			const functionBody = functionBodyFromExpression(child.expression)

			if (functionBody) return analyzeFunctionBody(context, functionBody, stack)
		}

		return [
			opaque(
				`Solid loop without an inline render function`,
				context.sourceFile,
				child,
			),
		]
	})
}

function analyzeSolidFallback(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] | undefined {
	const fallback = findJsxAttribute(context, node, `fallback`)

	return fallback
		? analyzeJsxAttributeRenderValue(context, fallback, stack)
		: undefined
}

function analyzeSolidSwitchAlternatives(
	context: AnalyzeContext,
	children: readonly ts.JsxChild[],
	stack: string[],
): StoryChild[][] {
	return children.flatMap((child): StoryChild[][] => {
		if (ts.isJsxText(child)) return []
		if (ts.isJsxExpression(child) && !child.expression) return []

		if (ts.isJsxFragment(child)) {
			return analyzeSolidSwitchAlternatives(context, child.children, stack)
		}

		if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
			const tagName = getJsxTagText(
				context.sourceFile,
				ts.isJsxElement(child) ? child.openingElement.tagName : child.tagName,
			)
			const binding = resolveImportBinding(context, tagName)

			if (
				binding?.moduleName === `solid-js` &&
				binding.importedName === `Match`
			) {
				return [analyzeSolidTransparentChildren(context, child, stack)]
			}
		}

		return [
			[opaque(`non-Match child in Solid Switch`, context.sourceFile, child)],
		]
	})
}

function dynamicComponentValue(
	context: AnalyzeContext,
	attribute: ts.JsxAttribute,
):
	| { kind: `literal`; tagName: string }
	| { kind: `local`; name: string }
	| undefined {
	const initializer = attribute.initializer

	if (initializer && ts.isStringLiteral(initializer)) {
		return { kind: `literal`, tagName: initializer.text }
	}

	if (!initializer || !ts.isJsxExpression(initializer)) return

	let expression = initializer.expression

	while (
		expression &&
		(ts.isParenthesizedExpression(expression) ||
			ts.isAsExpression(expression) ||
			ts.isSatisfiesExpression(expression) ||
			ts.isNonNullExpression(expression) ||
			ts.isTypeAssertion(expression))
	) {
		expression = expression.expression
	}

	if (expression && ts.isStringLiteralLikeNode(expression)) {
		return { kind: `literal`, tagName: expression.text }
	}

	if (
		expression &&
		ts.isIdentifier(expression) &&
		context.components.has(expression.text)
	) {
		return { kind: `local`, name: expression.text }
	}
}

function lowerSolidComponent(
	context: AnalyzeContext,
	tagName: string,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] | undefined {
	const binding = resolveImportBinding(context, tagName)

	if (!binding) return

	if (binding.moduleName === `solid-js`) {
		if (binding.importedName === `Show`) {
			return [
				choice(
					[
						analyzeSolidTransparentChildren(context, node, stack),
						analyzeSolidFallback(context, node, stack) ?? [],
					],
					context.sourceFile,
					node,
				),
			]
		}

		if (binding.importedName === `For` || binding.importedName === `Index`) {
			return [
				choice(
					[
						analyzeSolidRepeatedChildren(context, node, stack),
						analyzeSolidFallback(context, node, stack) ?? [],
					],
					context.sourceFile,
					node,
				),
			]
		}

		if (binding.importedName === `Switch`) {
			const alternatives = analyzeSolidSwitchAlternatives(
				context,
				jsxChildren(node),
				stack,
			)

			alternatives.push(analyzeSolidFallback(context, node, stack) ?? [])

			return [choice(alternatives, context.sourceFile, node)]
		}

		if (
			binding.importedName === `ErrorBoundary` ||
			binding.importedName === `Suspense`
		) {
			return [
				choice(
					[
						analyzeSolidTransparentChildren(context, node, stack),
						analyzeSolidFallback(context, node, stack) ?? [],
					],
					context.sourceFile,
					node,
				),
			]
		}

		if (binding.importedName === `SuspenseList`) {
			return analyzeSolidTransparentChildren(context, node, stack)
		}

		return
	}

	if (
		binding.moduleName === `solid-js/web` &&
		binding.importedName === `Dynamic`
	) {
		const componentAttribute = findJsxAttribute(context, node, `component`)
		const componentValue = componentAttribute
			? dynamicComponentValue(context, componentAttribute)
			: undefined

		if (componentValue?.kind === `local`) {
			return analyzeComponent(context, componentValue.name, stack)
		}

		if (componentValue?.kind === `literal`) {
			return [
				createStoryNode(
					context,
					componentValue.tagName,
					ts.isJsxElement(node)
						? analyzeJsxChildren(context, node.children, stack)
						: [],
					rangeOf(context.sourceFile, componentAttribute ?? node),
					jsxAttributes(node),
					new Set([`component`]),
				),
			]
		}

		return [
			foreignOpaque(
				`unknown Solid Dynamic component`,
				context.sourceFile,
				node,
			),
		]
	}

	if (
		binding.moduleName === `solid-js/web` &&
		binding.importedName === `NoHydration`
	) {
		return analyzeSolidTransparentChildren(context, node, stack)
	}
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
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] {
	const loweredChildren = lowerSolidComponent(context, tagName, node, stack)

	if (loweredChildren) return loweredChildren

	if (!isComponentName(tagName) || tagName.includes(`.`)) {
		return [foreignOpaque(`dynamic JSX component`, context.sourceFile, node)]
	}

	if (!context.components.has(tagName)) {
		const binding = context.imports.get(tagName)
		const expectedRootTagName = binding?.moduleName.startsWith(`.`)
			? toKebabCase(
					binding.importedName === `default` ? tagName : binding.importedName,
				)
			: undefined

		return [
			foreignOpaque(
				`imported or external component`,
				context.sourceFile,
				node,
				expectedRootTagName,
			),
		]
	}

	return analyzeComponent(context, tagName, stack)
}

function analyzeJsxChild(
	context: AnalyzeContext,
	child: ts.JsxChild,
	stack: string[],
): StoryChild[] {
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
}

function analyzeJsxChildren(
	context: AnalyzeContext,
	children: ts.NodeArray<ts.JsxChild>,
	stack: string[],
): StoryChild[] {
	return children.flatMap((child) => analyzeJsxChild(context, child, stack))
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
		ts.isStringLiteralLikeNode(argumentExpression) &&
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
		ts.isTypeAssertion(expression)
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
			choice(
				[
					analyzeExpression(context, expression.whenTrue, stack),
					analyzeExpression(context, expression.whenFalse, stack),
				],
				context.sourceFile,
				expression,
			),
		]
	}

	if (ts.isBinaryExpression(expression)) {
		if (
			expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
		) {
			return [
				choice(
					[[], analyzeExpression(context, expression.right, stack)],
					context.sourceFile,
					expression,
				),
			]
		}

		if (
			expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
			expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
		) {
			return [
				choice(
					[
						analyzeExpression(context, expression.left, stack),
						analyzeExpression(context, expression.right, stack),
					],
					context.sourceFile,
					expression,
				),
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
		const mappedChildren = analyzeMapCall(context, expression, stack)

		if (mappedChildren) return mappedChildren
		if (isImportedCall(context, expression, `react-dom`, `createPortal`)) {
			return []
		}

		return [
			isRenderPropCall(expression)
				? foreignOpaque(`render prop call`, context.sourceFile, expression)
				: opaque(`unsupported render call`, context.sourceFile, expression),
		]
	}

	if (expression.kind === ts.SyntaxKind.NullKeyword) return []
	if (expression.kind === ts.SyntaxKind.FalseKeyword) return []

	if (isChildrenExpression(expression)) {
		return [
			foreignOpaque(
				`children prop render branch`,
				context.sourceFile,
				expression,
			),
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

function withSourceFile<TResult>(
	options: AnalyzeTsxOptions,
	typescriptSession: TypescriptAstSession | undefined,
	use: (sourceFile: ts.SourceFile) => TResult,
): TResult {
	const session =
		typescriptSession ??
		createTypescriptAstSession(
			options.typescriptSdkPath
				? { typescriptSdkPath: options.typescriptSdkPath }
				: {},
		)

	try {
		return session.withSourceFile(
			options.sourceText,
			options.filePath ?? `component.tsx`,
			use,
		)
	} finally {
		if (!typescriptSession) session.close()
	}
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
		imports: index.imports,
		namespaceImports: index.namespaceImports,
		warnings,
		maxComponentDepth: options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH,
	}
}

function analyzeIndexedComponent(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	componentName: string,
	options: Pick<
		AnalyzeTsxOptions,
		"maxComponentDepth" | "scopeToCssClassRoots"
	>,
): RenderStory {
	const warnings: RenderStoryWarning[] = []
	const context = createAnalyzeContext(sourceFile, index, warnings, options)
	const renderStory = {
		componentName,
		roots: analyzeComponent(context, componentName, []),
		warnings,
	}

	return options.scopeToCssClassRoots === false
		? renderStory
		: scopeRenderStoryToCssClassRoots(renderStory)
}

export function analyzeTsxRenderStory(
	options: AnalyzeTsxOptions,
	typescriptSession?: TypescriptAstSession,
): RenderStory {
	return withSourceFile(options, typescriptSession, (sourceFile) => {
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
		const renderStory = {
			componentName,
			roots: analyzeComponent(context, componentName, []),
			warnings,
		}

		return options.scopeToCssClassRoots === false
			? renderStory
			: scopeRenderStoryToCssClassRoots(renderStory)
	})
}

export function analyzeTsxRenderStories(
	options: AnalyzeTsxRenderStoriesOptions,
	typescriptSession?: TypescriptAstSession,
): RenderStory[] {
	return withSourceFile(options, typescriptSession, (sourceFile) => {
		const index = collectComponentIndex(sourceFile)

		return selectComponentStories(index, options).map((componentName) =>
			analyzeIndexedComponent(sourceFile, index, componentName, options),
		)
	})
}
