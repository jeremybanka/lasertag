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
import { mappedRenderSourcesFromDeclarations } from "./render-story-source-map.ts"
import { isStandardIntrinsicTagName } from "./standard-intrinsic-tag-names.ts"
import {
	createTypescriptAstSession,
	type TypescriptAstAnalysis,
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
	body?: ts.ConciseBody
	initializer?: ts.Expression
	range: SourceRange
}

type ImportBinding = {
	importedName: string
	moduleName: string
}

type ComponentIndex = {
	components: Map<string, ComponentDefinition>
	mainCandidates: Set<string>
	exportedNames: Set<string>
	imports: Map<string, ImportBinding>
	namespaceImports: Map<string, string>
	defaultExportName?: string
}

type ImportIndex = Pick<ComponentIndex, `imports` | `namespaceImports`>

type AnalyzeContext = {
	sourceFile: ts.SourceFile
	components: Map<string, ComponentDefinition>
	imports: Map<string, ImportBinding>
	namespaceImports: Map<string, string>
	warnings: RenderStoryWarning[]
	maxComponentDepth: number
	typescriptSdkPath?: string
	typescriptAnalysis: TypescriptAstAnalysis
	resolvedDeclarations: Map<ts.Node, ts.Node[]>
	foreignComponentStack: ReadonlySet<string>
	externalComponentOutput: WeakSet<OpaqueStoryNode>
}

const DEFAULT_MAX_COMPONENT_DEPTH = 25
const ADOPT_SUBTREE_DIRECTIVE = `@lasertag-adopt-subtree`
const LEGACY_OWN_SUBTREE_DIRECTIVE = `@lasertag-own-subtree`

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
	componentName?: string,
): OpaqueStoryNode {
	return {
		kind: `opaque`,
		reason,
		ownership: `foreign`,
		range: rangeOf(sourceFile, node),
		...(componentName ? { componentName } : {}),
		...(expectedRootTagName ? { expectedRootTagName } : {}),
	}
}

function externalComponentOpaque(
	context: AnalyzeContext,
	reason: string,
	node: ts.Node,
	componentName?: string,
): OpaqueStoryNode {
	const result = foreignOpaque(
		reason,
		context.sourceFile,
		node,
		undefined,
		componentName,
	)
	// Independent imported components keep their own CSS scope. This origin is
	// separate from ownership: local spreads and shadowed bindings are also foreign.
	context.externalComponentOutput.add(result)
	return result
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
	imports?: ImportIndex,
): ts.ConciseBody | undefined {
	expression = unwrapExpression(expression)
	if (isFunctionExpression(expression)) return expression.body

	if (
		imports &&
		ts.isCallExpression(expression) &&
		isKnownComponentFactory(imports, expression)
	) {
		const render = expression.arguments[0]
		return render ? functionBodyFromExpression(render, imports) : undefined
	}
}

function isKnownComponentFactory(
	imports: ImportIndex,
	call: ts.CallExpression,
): boolean {
	// Only documented component wrappers preserve the first argument's render
	// structure. Arbitrary factories may add DOM or ignore the callback entirely.
	const binding = resolveIndexedImportBinding(imports, call.expression)
	return (
		binding !== undefined &&
		isComponentFactoryModule(binding.moduleName) &&
		(binding.importedName === `memo` || binding.importedName === `forwardRef`)
	)
}

function isComponentFactoryModule(moduleName: string): boolean {
	return moduleName === `react` || moduleName === `preact/compat`
}

function mayBeComponentInitializer(expression: ts.Expression): boolean {
	expression = unwrapExpression(expression)
	if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
		// Solid component JSX evaluates to the component's return value, which
		// may itself be callable. Only intrinsic JSX is known to be non-callable.
		const tagName = jsxTagName(expression)
		return !ts.isIdentifier(tagName) || !isIntrinsicJsxTag(tagName.text)
	}
	if (ts.isConditionalExpression(expression)) {
		return (
			mayBeComponentInitializer(expression.whenTrue) ||
			mayBeComponentInitializer(expression.whenFalse)
		)
	}
	// Keep calls, aliases, and other unknown bindings as possible components,
	// but do not let statically non-callable exports compete with a component.
	return !(
		ts.isLiteralExpression(expression) ||
		ts.isTemplateExpression(expression) ||
		ts.isPrefixUnaryExpression(expression) ||
		ts.isTypeOfExpression(expression) ||
		ts.isVoidExpression(expression) ||
		ts.isObjectLiteralExpression(expression) ||
		ts.isArrayLiteralExpression(expression) ||
		expression.kind === ts.SyntaxKind.NullKeyword ||
		expression.kind === ts.SyntaxKind.TrueKeyword ||
		expression.kind === ts.SyntaxKind.FalseKeyword
	)
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

		const body = functionBodyFromExpression(declaration.initializer, index)

		const name = declaration.name.text
		if (!body && !isComponentName(name)) continue

		index.components.set(name, {
			name,
			...(body ? { body } : { initializer: declaration.initializer }),
			range: rangeOf(sourceFile, declaration),
		})
		if (body || mayBeComponentInitializer(declaration.initializer)) {
			index.mainCandidates.add(name)
		}

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
	if (!statement.body) return
	const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
	const name = statement.name?.text ?? (isDefault ? `default` : undefined)
	if (!name) return

	index.components.set(name, {
		name,
		body: statement.body,
		range: rangeOf(sourceFile, statement),
	})
	index.mainCandidates.add(name)

	if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
		index.exportedNames.add(name)
	}

	if (isDefault) {
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

function addDefaultExport(
	sourceFile: ts.SourceFile,
	index: ComponentIndex,
	statement: ts.Statement,
) {
	let expression: ts.Expression | undefined
	let localName: string | undefined
	if (ts.isExportAssignment(statement)) {
		expression = unwrapExpression(statement.expression)
		if (ts.isIdentifier(expression)) localName = expression.text
	} else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
		const clause = statement.exportClause
		if (!clause || !ts.isNamedExports(clause)) return
		const exported = clause.elements.find(
			(element) => !element.isTypeOnly && element.name.text === `default`,
		)
		if (!exported) return
		if (!statement.moduleSpecifier)
			localName = (exported.propertyName ?? exported.name).text
	} else if (
		!ts.isClassDeclaration(statement) ||
		!hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
	) {
		return
	}

	if (localName && index.components.has(localName)) {
		index.defaultExportName = localName
		index.exportedNames.add(localName)
		return
	}

	// `default` cannot collide with a JavaScript binding. Keep an unsupported
	// default export here so selection cannot silently substitute a named export.
	const name = `default`
	const body = expression
		? functionBodyFromExpression(expression, index)
		: undefined
	index.components.set(name, {
		name,
		...(body ? { body } : {}),
		...(expression ? { initializer: expression } : {}),
		range: rangeOf(sourceFile, statement),
	})
	if (!expression || mayBeComponentInitializer(expression))
		index.mainCandidates.add(name)
	index.defaultExportName = name
	index.exportedNames.add(name)
}

function addImportDeclaration(
	index: ImportIndex,
	statement: ts.ImportDeclaration,
) {
	if (!ts.isStringLiteralLikeNode(statement.moduleSpecifier)) return

	const importClause = statement.importClause

	if (!importClause || importClause.phaseModifier === ts.SyntaxKind.TypeKeyword)
		return

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

function collectImportIndex(sourceFile: ts.SourceFile): ImportIndex {
	const index: ImportIndex = { imports: new Map(), namespaceImports: new Map() }
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			addImportDeclaration(index, statement)
		}
	}
	return index
}

function collectComponentIndex(sourceFile: ts.SourceFile): ComponentIndex {
	const index: ComponentIndex = {
		...collectImportIndex(sourceFile),
		components: new Map(),
		mainCandidates: new Set(),
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
	}
	// Resolve default aliases after every local declaration has been indexed.
	for (const statement of sourceFile.statements) {
		addDefaultExport(sourceFile, index, statement)
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

	if (
		fileStemName &&
		index.exportedNames.has(fileStemName) &&
		index.mainCandidates.has(fileStemName)
	) {
		return fileStemName
	}

	if (
		index.defaultExportName &&
		index.mainCandidates.has(index.defaultExportName)
	) {
		return index.defaultExportName
	}

	const exportedComponentNames = [...index.exportedNames].filter((name) =>
		index.mainCandidates.has(name),
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
			.filter(([componentName, definition]) => {
				const source = definition.body ?? definition.initializer
				return (
					(isComponentName(componentName) ||
						componentName === index.defaultExportName) &&
					index.mainCandidates.has(componentName) &&
					source !== undefined &&
					containsJsx(source)
				)
			})
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

	if (!definition.body) {
		return [
			{
				kind: `opaque`,
				reason: `unknown component implementation`,
				range: definition.range,
			},
		]
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

function addressableForeignRoot(
	context: AnalyzeContext,
	tagName: string,
	componentName: string,
	node: ComponentJsxNode,
	tagNameNode: ts.JsxTagNameExpression,
): StoryNode {
	return {
		addressable: true,
		children: [
			externalComponentOpaque(
				context,
				`asserted component implementation`,
				node,
			),
		],
		componentName,
		kind: `element`,
		ownership: `foreign`,
		range: rangeOf(context.sourceFile, tagNameNode),
		tagName,
	}
}

function foreignRoot(
	context: AnalyzeContext,
	tagName: string,
	componentName: string,
	node: ComponentJsxNode,
): StoryNode {
	return {
		children: [
			externalComponentOpaque(context, `component implementation`, node),
		],
		componentName,
		kind: `element`,
		ownership: `foreign`,
		range: rangeOf(context.sourceFile, node),
		tagName,
	}
}

function componentDefinitionFromDeclaration(
	sourceFile: ts.SourceFile,
	declaration: ts.Node,
	componentName: string,
): ComponentDefinition | undefined {
	if (ts.isFunctionDeclaration(declaration) && declaration.body) {
		return {
			body: declaration.body,
			name: declaration.name?.text ?? componentName,
			range: rangeOf(sourceFile, declaration),
		}
	}

	if (
		ts.isVariableDeclaration(declaration) &&
		declaration.initializer &&
		ts.isIdentifier(declaration.name)
	) {
		const body = functionBodyFromExpression(
			declaration.initializer,
			collectImportIndex(sourceFile),
		)

		return body
			? {
					body,
					name: declaration.name.text,
					range: rangeOf(sourceFile, declaration),
				}
			: undefined
	}

	if (ts.isExportAssignment(declaration)) {
		const body = functionBodyFromExpression(
			declaration.expression,
			collectImportIndex(sourceFile),
		)

		return body
			? {
					body,
					name: componentName,
					range: rangeOf(sourceFile, declaration),
				}
			: undefined
	}
}

type ResolvedForeignComponent = {
	definition: ComponentDefinition
	sourceFile: ts.SourceFile
}

type ForeignComponentResolution = {
	declarations: ts.Node[]
	implementation?: ResolvedForeignComponent
}

type ResolvedComponentStory = {
	roots: StoryChild[]
	sourcePath: string
	warnings: RenderStoryWarning[]
}

function componentNameFromDeclaration(
	declaration: ts.Node,
): string | undefined {
	if (ts.isFunctionDeclaration(declaration)) return declaration.name?.text

	if (
		ts.isVariableDeclaration(declaration) &&
		ts.isIdentifier(declaration.name)
	) {
		return declaration.name.text
	}
}

function resolveForeignComponent(
	context: AnalyzeContext,
	tagNameNode: ts.JsxTagNameExpression,
	componentName: string,
): ForeignComponentResolution {
	const declarations = resolveDeclarations(context, tagNameNode)

	for (const declaration of declarations) {
		const sourceFile = declaration.getSourceFile()
		const definition = componentDefinitionFromDeclaration(
			sourceFile,
			declaration,
			componentName,
		)

		if (definition) {
			return {
				declarations,
				implementation: { definition, sourceFile },
			}
		}
	}

	return { declarations }
}

function foreignRootsFromResolvedStory(
	context: AnalyzeContext,
	children: StoryChild[],
	componentName: string,
	node: ComponentJsxNode,
): StoryChild[] {
	return children.map((child): StoryChild => {
		if (child.kind === `element`) {
			return foreignRoot(context, child.tagName, componentName, node)
		}

		if (child.kind === `choice`) {
			return choice(
				child.alternatives.map((alternative) =>
					foreignRootsFromResolvedStory(
						context,
						alternative,
						componentName,
						node,
					),
				),
				context.sourceFile,
				node,
			)
		}

		return externalComponentOpaque(
			context,
			`resolved component root remains opaque`,
			node,
			componentName,
		)
	})
}

function analyzeResolvedComponentStory(
	context: AnalyzeContext,
	resolved: ResolvedForeignComponent,
): ResolvedComponentStory | undefined {
	if (context.foreignComponentStack.size >= context.maxComponentDepth) return

	const resolutionKey = `${resolved.sourceFile.fileName}:${resolved.definition.range.start}`

	if (context.foreignComponentStack.has(resolutionKey)) return

	const index = collectComponentIndex(resolved.sourceFile)

	index.components.set(resolved.definition.name, resolved.definition)

	const importedContext: AnalyzeContext = {
		components: index.components,
		externalComponentOutput: context.externalComponentOutput,
		foreignComponentStack: new Set([
			...context.foreignComponentStack,
			resolutionKey,
		]),
		imports: index.imports,
		maxComponentDepth: context.maxComponentDepth,
		resolvedDeclarations: context.resolvedDeclarations,
		namespaceImports: index.namespaceImports,
		sourceFile: resolved.sourceFile,
		...(context.typescriptSdkPath
			? { typescriptSdkPath: context.typescriptSdkPath }
			: {}),
		typescriptAnalysis: context.typescriptAnalysis,
		warnings: [],
	}
	const roots = analyzeComponent(importedContext, resolved.definition.name, [])

	return {
		roots,
		sourcePath: resolved.sourceFile.fileName,
		warnings: importedContext.warnings,
	}
}

function analyzeForeignComponent(
	context: AnalyzeContext,
	tagName: string,
	tagNameNode: ts.JsxTagNameExpression,
	node: ComponentJsxNode,
): StoryChild[] | undefined {
	const resolution = resolveForeignComponent(context, tagNameNode, tagName)
	const story = resolution.implementation
		? analyzeResolvedComponentStory(context, resolution.implementation)
		: undefined

	return story
		? foreignRootsFromResolvedStory(context, story.roots, tagName, node)
		: undefined
}

type AdoptionRequest = {
	range: SourceRange
}

type MappedComponentStoryResolution =
	| { kind: `missing` }
	| { kind: `ambiguous`; sourcePaths: string[] }
	| { kind: `ready`; story: ResolvedComponentStory }

function hasProvableElement(children: readonly StoryChild[]): boolean {
	return children.some((child) => {
		if (child.kind === `element`) return true
		if (child.kind === `opaque`) return false

		return child.alternatives.some(hasProvableElement)
	})
}

function componentWasFound(renderStory: RenderStory): boolean {
	return !(
		renderStory.roots.length === 1 &&
		renderStory.roots[0]?.kind === `opaque` &&
		renderStory.roots[0].reason === `main component not found`
	)
}

function declarationSources(
	declarations: readonly ts.Node[],
): Array<{ filePath: string; sourceText: string }> {
	const sources = new Map<string, { filePath: string; sourceText: string }>()

	for (const declaration of declarations) {
		const sourceFile = declaration.getSourceFile()

		sources.set(sourceFile.fileName, {
			filePath: sourceFile.fileName,
			sourceText: sourceFile.text,
		})
	}

	return [...sources.values()]
}

function resolveMappedComponentStory(
	context: AnalyzeContext,
	resolution: ForeignComponentResolution,
	componentName: string,
): MappedComponentStoryResolution {
	const mappedSources = mappedRenderSourcesFromDeclarations(
		declarationSources(resolution.declarations),
	)

	if (mappedSources.length === 0) return { kind: `missing` }

	const componentNames = new Set([
		componentName,
		...resolution.declarations.flatMap((declaration) => {
			const name = componentNameFromDeclaration(declaration)

			return name ? [name] : []
		}),
	])
	const stories = new Map<string, ResolvedComponentStory>()
	const typescriptSession = createTypescriptAstSession(
		context.typescriptSdkPath
			? { typescriptSdkPath: context.typescriptSdkPath }
			: {},
	)

	try {
		for (const source of mappedSources) {
			for (const candidateName of componentNames) {
				const renderStory = analyzeTsxRenderStory(
					{
						componentName: candidateName,
						filePath: source.filePath,
						maxComponentDepth: context.maxComponentDepth,
						scopeToCssClassRoots: false,
						sourceText: source.sourceText,
					},
					typescriptSession,
				)

				if (!componentWasFound(renderStory)) continue

				stories.set(`${source.filePath}\0${renderStory.componentName}`, {
					roots: renderStory.roots,
					sourcePath: source.filePath,
					warnings: renderStory.warnings,
				})
			}
		}
	} finally {
		typescriptSession.close()
	}

	const matches = [...stories.values()]

	if (matches.length === 0) return { kind: `missing` }
	if (matches.length === 1 && matches[0]) {
		return { kind: `ready`, story: matches[0] }
	}

	return {
		kind: `ambiguous`,
		sourcePaths: [...new Set(matches.map((match) => match.sourcePath))],
	}
}

function withStorySourcePath(
	children: readonly StoryChild[],
	sourcePath: string,
): StoryChild[] {
	return children.map((child): StoryChild => {
		const childSourcePath = child.sourcePath ?? sourcePath

		if (child.kind === `opaque`) {
			return {
				...child,
				ownership: `foreign`,
				sourcePath: childSourcePath,
			}
		}

		if (child.kind === `choice`) {
			return {
				...child,
				alternatives: child.alternatives.map((alternative) =>
					withStorySourcePath(alternative, childSourcePath),
				),
				sourcePath: childSourcePath,
			}
		}

		return {
			...child,
			children: withStorySourcePath(child.children, childSourcePath),
			sourcePath: childSourcePath,
		}
	})
}

function adoptionFailure(
	context: AnalyzeContext,
	componentName: string,
	adoption: AdoptionRequest,
	detail: string,
): void {
	context.warnings.push({
		code: `adoption-source-unavailable`,
		message: `Could not adopt the render story for ${componentName}: ${detail}`,
		range: adoption.range,
		sourcePath: context.sourceFile.fileName,
	})
}

function invalidAdoptionTarget(
	context: AnalyzeContext,
	adoption: AdoptionRequest,
	detail: string,
): void {
	context.warnings.push({
		code: `invalid-adoption-target`,
		message: `Could not apply ${ADOPT_SUBTREE_DIRECTIVE}: ${detail}`,
		range: adoption.range,
		sourcePath: context.sourceFile.fileName,
	})
}

function invalidAdoptionDirective(
	context: AnalyzeContext,
	range: SourceRange,
	detail: string,
): void {
	context.warnings.push({
		code: `invalid-adoption-directive`,
		message: `Could not apply ${ADOPT_SUBTREE_DIRECTIVE}: ${detail}`,
		range,
		sourcePath: context.sourceFile.fileName,
	})
}

function analyzeAdoptedForeignComponent(
	context: AnalyzeContext,
	componentName: string,
	tagNameNode: ts.JsxTagNameExpression,
	adoption: AdoptionRequest,
): StoryChild[] | undefined {
	const resolution = resolveForeignComponent(
		context,
		tagNameNode,
		componentName,
	)
	let resolvedStory = resolution.implementation
		? analyzeResolvedComponentStory(context, resolution.implementation)
		: undefined

	if (!resolvedStory) {
		const mappedResolution = resolveMappedComponentStory(
			context,
			resolution,
			componentName,
		)

		if (mappedResolution.kind === `ambiguous`) {
			adoptionFailure(
				context,
				componentName,
				adoption,
				`declaration source maps identify multiple component implementations (${mappedResolution.sourcePaths.join(`, `)}).`,
			)
			return
		}

		if (mappedResolution.kind === `ready`) {
			resolvedStory = mappedResolution.story
		}
	}

	if (!resolvedStory) {
		adoptionFailure(
			context,
			componentName,
			adoption,
			`no analyzable JSX or TSX implementation was resolved directly or through declaration source-map evidence.`,
		)
		return
	}

	if (!hasProvableElement(resolvedStory.roots)) {
		adoptionFailure(
			context,
			componentName,
			adoption,
			`the resolved implementation has no provable JSX root.`,
		)
		return
	}

	context.warnings.push(
		...resolvedStory.warnings.map((warning) => ({
			...warning,
			sourcePath: warning.sourcePath ?? resolvedStory.sourcePath,
		})),
	)

	return withStorySourcePath(resolvedStory.roots, resolvedStory.sourcePath)
}

function isIntrinsicJsxTag(tagName: string): boolean {
	return /^[a-z]/.test(tagName) || tagName.includes(`-`)
}

function assertedForeignRootTagName(tagName: string): string | undefined {
	const separatorIndex = tagName.indexOf(`.`)

	if (separatorIndex < 1) return

	const namespaceName = tagName.slice(0, separatorIndex)

	return isStandardIntrinsicTagName(namespaceName) ? namespaceName : undefined
}

function assertedForeignComponentName(tagName: string): string {
	return tagName.slice(tagName.indexOf(`.`) + 1)
}

function isFragmentJsxTag(
	context: AnalyzeContext,
	name: ts.JsxTagNameExpression,
): boolean {
	const tagName = name.getText(context.sourceFile)
	if (isIntrinsicJsxTag(tagName) && !tagName.includes(`.`)) return false
	if (hasShadowedBinding(context, name)) return false
	const binding = resolveImportBinding(context, name)
	if (binding) {
		return (
			binding.importedName === `Fragment` &&
			[
				`react`,
				`react/jsx-runtime`,
				`react/jsx-dev-runtime`,
				`preact`,
				`preact/compat`,
				`preact/jsx-runtime`,
				`preact/jsx-dev-runtime`,
			].includes(binding.moduleName)
		)
	}
	const root = expressionRoot(name)
	if (
		!ts.isIdentifier(root) ||
		context.components.has(root.text) ||
		context.imports.has(root.text) ||
		context.namespaceImports.has(root.text) ||
		resolveDeclarations(context, root).length > 0
	)
		return false
	// Keep the legacy spelling fallback only for an unbound framework global.
	return tagName === `Fragment` || tagName === `React.Fragment`
}

type ComponentJsxNode = ts.JsxElement | ts.JsxSelfClosingElement
type ComponentJsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

function openingTagCommentRanges(
	context: AnalyzeContext,
	node: ComponentJsxOpening,
): SourceRange[] {
	const positions = [
		node.tagName.end,
		...node.attributes.properties.map((attribute) => attribute.end),
	]
	const ranges = new Map<string, SourceRange>()

	for (const position of positions) {
		const comments = [
			...(ts.getLeadingCommentRanges(context.sourceFile.text, position) ?? []),
			...(ts.getTrailingCommentRanges(context.sourceFile.text, position) ?? []),
		]

		for (const comment of comments) {
			if (comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
			if (comment.pos < node.tagName.end || comment.end > node.end) continue

			const range = { end: comment.end, start: comment.pos }

			ranges.set(`${range.start}:${range.end}`, range)
		}
	}

	return [...ranges.values()].toSorted(
		(left, right) => left.start - right.start,
	)
}

function openingTagAdoptionRequest(
	context: AnalyzeContext,
	node: ComponentJsxOpening,
): AdoptionRequest | undefined {
	const exactDirectivePattern = new RegExp(
		String.raw`^\/\*\s*${ADOPT_SUBTREE_DIRECTIVE}\s*\*\/$`,
	)
	const directiveCandidatePattern = new RegExp(
		String.raw`^\/\*\s*${ADOPT_SUBTREE_DIRECTIVE}(?![\w-])`,
	)
	const legacyDirectiveCandidatePattern = new RegExp(
		String.raw`^\/\*\s*${LEGACY_OWN_SUBTREE_DIRECTIVE}(?![\w-])`,
	)
	let adoption: AdoptionRequest | undefined

	for (const range of openingTagCommentRanges(context, node)) {
		const commentText = context.sourceFile.text.slice(range.start, range.end)

		if (legacyDirectiveCandidatePattern.test(commentText)) {
			invalidAdoptionDirective(
				context,
				range,
				`${LEGACY_OWN_SUBTREE_DIRECTIVE} is no longer supported; place /* ${ADOPT_SUBTREE_DIRECTIVE} */ inside the component opening tag.`,
			)
			continue
		}

		if (!directiveCandidatePattern.test(commentText)) continue

		if (!exactDirectivePattern.test(commentText)) {
			invalidAdoptionDirective(
				context,
				range,
				`the directive must be the only content in its opening-tag block comment.`,
			)
			continue
		}

		if (adoption) {
			invalidAdoptionDirective(
				context,
				range,
				`the directive may appear only once in a component opening tag.`,
			)
			continue
		}

		adoption = { range }
	}

	return adoption
}

function jsxAttributes(node: ComponentJsxNode): ts.JsxAttributes {
	return ts.isJsxElement(node)
		? node.openingElement.attributes
		: node.attributes
}

function jsxChildren(node: ComponentJsxNode): ts.NodeArray<ts.JsxChild> | [] {
	return ts.isJsxElement(node) ? node.children : []
}

function jsxTagName(node: ComponentJsxNode): ts.JsxTagNameExpression {
	return ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
}

function resolveDeclarations(
	context: AnalyzeContext,
	node: ts.Node,
): ts.Node[] {
	const cached = context.resolvedDeclarations.get(node)
	if (cached !== undefined) return cached
	const declarations =
		context.typescriptAnalysis.resolveAliasedDeclarations(node)
	context.resolvedDeclarations.set(node, declarations)
	return declarations
}

function expressionRoot(expression: ts.Expression): ts.Expression {
	let root = unwrapExpression(expression)
	while (
		ts.isPropertyAccessExpression(root) ||
		ts.isElementAccessExpression(root)
	)
		root = unwrapExpression(root.expression)
	return root
}

function hasShadowedBinding(
	context: AnalyzeContext,
	expression: ts.Expression,
): boolean {
	const root = expressionRoot(expression)
	if (!ts.isIdentifier(root)) return false
	const definition = context.components.get(root.text)
	return resolveDeclarations(context, root).some((declaration) => {
		if (declaration.getSourceFile().fileName !== context.sourceFile.fileName)
			return false
		// Unresolved imports retain their local alias declaration. They still refer
		// to the indexed import, unlike a parameter or local binding of that name.
		if (
			ts.isImportSpecifier(declaration) ||
			ts.isImportClause(declaration) ||
			ts.isNamespaceImport(declaration)
		)
			return false
		return (
			!definition ||
			declaration.getStart(context.sourceFile) !== definition.range.start ||
			declaration.end !== definition.range.end
		)
	})
}

type RenderPropSemantics = {
	allowFunction?: boolean
	undefinedFallsThrough?: boolean
}

const SOLID_RENDER_PROPS: RenderPropSemantics = {
	allowFunction: true,
	undefinedFallsThrough: true,
}

function isDefinitelyDefined(expression: ts.Expression): boolean {
	expression = unwrapExpression(expression)
	if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
		const tagName = jsxTagName(expression)
		return ts.isIdentifier(tagName) && isIntrinsicJsxTag(tagName.text)
	}
	if (ts.isConditionalExpression(expression)) {
		return (
			isDefinitelyDefined(expression.whenTrue) &&
			isDefinitelyDefined(expression.whenFalse)
		)
	}
	return (
		ts.isArrayLiteralExpression(expression) ||
		ts.isObjectLiteralExpression(expression) ||
		isFunctionExpression(expression) ||
		ts.isLiteralExpression(expression) ||
		expression.kind === ts.SyntaxKind.NullKeyword ||
		expression.kind === ts.SyntaxKind.TrueKeyword ||
		expression.kind === ts.SyntaxKind.FalseKeyword
	)
}

function meaningfulJsxChildren(
	children: readonly ts.JsxChild[],
): ts.JsxChild[] {
	return children.filter((child) => {
		if (ts.isJsxExpression(child) && !child.expression) return false
		if (ts.isJsxText(child))
			return child.text.trim().length > 0 || !/[\r\n]/.test(child.text)
		return true
	})
}

function resolveJsxProp(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	name: string,
	semantics: RenderPropSemantics = {},
): {
	attribute?: ts.JsxAttribute
	body?: readonly ts.JsxChild[]
	unknownSpread: boolean
} {
	const children =
		name === `children` ? meaningfulJsxChildren(jsxChildren(node)) : []
	const child = children[0]
	const body = child ? jsxChildren(node) : undefined
	// Solid's compiler can omit explicit children whenever a JSX body exists,
	// including a comment-only body. Such an attribute cannot exclude a spread.
	const solidChildrenBody =
		semantics.undefinedFallsThrough &&
		name === `children` &&
		jsxChildren(node).length > 0
	if (
		child &&
		(!semantics.undefinedFallsThrough ||
			children.length > 1 ||
			ts.isJsxText(child) ||
			(ts.isJsxExpression(child)
				? child.expression && isDefinitelyDefined(child.expression)
				: isDefinitelyDefined(child)))
	) {
		return { body: jsxChildren(node), unknownSpread: false }
	}

	let attribute: ts.JsxAttribute | undefined
	let unknownSpread = false
	const attributes = jsxAttributes(node).properties
	for (let index = attributes.length - 1; index >= 0; index--) {
		const candidate = attributes[index]!
		if (ts.isJsxSpreadAttribute(candidate)) {
			unknownSpread = true
			continue
		}
		// The JSX body replaces explicit children attributes. Within one prop
		// object, duplicate attributes also use ordinary last-write precedence.
		if (
			body ||
			attribute ||
			candidate.name.getText(context.sourceFile) !== name
		)
			continue
		attribute = candidate
		const initializer = attribute.initializer
		if (solidChildrenBody) continue
		if (
			!semantics.undefinedFallsThrough ||
			!initializer ||
			!ts.isJsxExpression(initializer) ||
			(initializer.expression && isDefinitelyDefined(initializer.expression))
		)
			break
		// Solid mergeProps skips undefined between prop sources, so an earlier
		// spread can remain live even after an explicit attribute or JSX body.
	}
	return {
		...(attribute ? { attribute } : {}),
		...(body ? { body } : {}),
		unknownSpread,
	}
}

function resolveImportBinding(
	context: AnalyzeContext,
	location: ts.Expression,
): ImportBinding | undefined {
	if (hasShadowedBinding(context, unwrapExpression(location))) return
	return resolveIndexedImportBinding(context, location)
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
	while (
		ts.isParenthesizedExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isTypeAssertion(expression)
	) {
		expression = expression.expression
	}
	return expression
}

function resolveIndexedImportBinding(
	index: ImportIndex,
	expression: ts.Expression,
): ImportBinding | undefined {
	expression = unwrapExpression(expression)
	if (ts.isIdentifier(expression)) return index.imports.get(expression.text)
	if (
		!ts.isPropertyAccessExpression(expression) &&
		!ts.isElementAccessExpression(expression)
	)
		return
	const namespace = unwrapExpression(expression.expression)
	if (!ts.isIdentifier(namespace)) return
	const member = ts.isPropertyAccessExpression(expression)
		? expression.name.text
		: ts.isStringLiteralLikeNode(expression.argumentExpression)
			? expression.argumentExpression.text
			: undefined
	if (!member) return
	const defaultBinding = index.imports.get(namespace.text)
	const moduleName =
		index.namespaceImports.get(namespace.text) ??
		(defaultBinding?.importedName === `default` &&
		isComponentFactoryModule(defaultBinding.moduleName)
			? defaultBinding.moduleName
			: undefined)

	if (!moduleName) return

	return {
		importedName: member,
		moduleName,
	}
}

function isImportedCall(
	context: AnalyzeContext,
	node: ts.CallExpression,
	moduleName: string,
	importedName: string,
): boolean {
	const binding = resolveImportBinding(context, node.expression)

	return (
		binding?.moduleName === moduleName && binding.importedName === importedName
	)
}

function expressionRootIdentifier(
	expression: ts.Expression,
): string | undefined {
	const current = expressionRoot(expression)
	return ts.isIdentifier(current) ? current.text : undefined
}

function isRenderPropCall(node: ts.CallExpression): boolean {
	return expressionRootIdentifier(node.expression) === `props`
}

function analyzeJsxAttributeRenderValue(
	context: AnalyzeContext,
	attribute: ts.JsxAttribute,
	stack: string[],
	allowFunction = false,
): StoryChild[] {
	const initializer = attribute.initializer

	if (!initializer || ts.isStringLiteral(initializer)) return []

	if (ts.isJsxExpression(initializer)) {
		if (!initializer.expression) return []

		const functionBody = allowFunction
			? functionBodyFromExpression(initializer.expression)
			: undefined

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

function hasMeaningfulJsxChildren(children: readonly ts.JsxChild[]): boolean {
	return meaningfulJsxChildren(children).length > 0
}

function analyzeJsxRenderProp(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	name: string,
	stack: string[],
	semantics: RenderPropSemantics = {},
): StoryChild[] | undefined {
	const { attribute, body, unknownSpread } = resolveJsxProp(
		context,
		node,
		name,
		semantics,
	)
	const rendered = body
		? analyzeJsxChildrenWith(context, body, (child) => {
				if (
					semantics.allowFunction &&
					ts.isJsxExpression(child) &&
					child.expression
				) {
					const functionBody = functionBodyFromExpression(child.expression)
					if (functionBody)
						return analyzeFunctionBody(context, functionBody, stack)
				}
				return analyzeJsxChild(context, child, stack)
			})
		: attribute
			? analyzeJsxAttributeRenderValue(
					context,
					attribute,
					stack,
					semantics.allowFunction,
				)
			: undefined
	if (unknownSpread) {
		return [
			choice(
				[
					rendered ?? [],
					[
						foreignOpaque(
							`spread component render props`,
							context.sourceFile,
							node,
						),
					],
				],
				context.sourceFile,
				node,
			),
		]
	}
	return rendered
}

function analyzeTransparentChildren(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
	semantics: RenderPropSemantics = {},
): StoryChild[] {
	const children = jsxChildren(node)
	if (!hasMeaningfulJsxChildren(children)) {
		// Comments do not override the children prop, but still carry directives.
		analyzeJsxChildren(context, children, stack)
	}
	return analyzeJsxRenderProp(context, node, `children`, stack, semantics) ?? []
}

function analyzeSolidTransparentChildren(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] {
	return analyzeTransparentChildren(context, node, stack, SOLID_RENDER_PROPS)
}

function analyzeSolidRepeatedChildren(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] {
	const children = jsxChildren(node)
	const { attribute: childrenAttribute } = resolveJsxProp(
		context,
		node,
		`children`,
		SOLID_RENDER_PROPS,
	)
	if (!hasMeaningfulJsxChildren(children) && childrenAttribute) {
		return analyzeTransparentChildren(context, node, stack, SOLID_RENDER_PROPS)
	}
	const hasMeaningfulChild = children.some(
		(child) =>
			!ts.isJsxText(child) && !(ts.isJsxExpression(child) && !child.expression),
	)
	const analyzedChildren = analyzeJsxChildrenWith(
		context,
		children,
		(child) => {
			if (ts.isJsxText(child)) return []
			if (ts.isJsxExpression(child) && !child.expression) return []

			if (ts.isJsxExpression(child) && child.expression) {
				const functionBody = functionBodyFromExpression(child.expression)

				if (functionBody) {
					return analyzeFunctionBody(context, functionBody, stack)
				}
			}

			return [
				opaque(
					`Solid loop without an inline render function`,
					context.sourceFile,
					child,
				),
			]
		},
	)

	if (!hasMeaningfulChild) {
		return [
			opaque(`Solid loop without a render function`, context.sourceFile, node),
		]
	}
	return analyzedChildren
}

function analyzeSolidFallback(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] | undefined {
	return analyzeJsxRenderProp(
		context,
		node,
		`fallback`,
		stack,
		SOLID_RENDER_PROPS,
	)
}

function analyzeSolidSwitchAlternatives(
	context: AnalyzeContext,
	children: readonly ts.JsxChild[],
	stack: string[],
): StoryChild[][] {
	const alternatives: StoryChild[][] = []

	for (const child of children) {
		if (misplacedAdoptionDirective(context, child)) continue

		if (ts.isJsxText(child)) continue
		if (ts.isJsxExpression(child) && !child.expression) continue

		if (ts.isJsxFragment(child)) {
			alternatives.push(
				...analyzeSolidSwitchAlternatives(context, child.children, stack),
			)
			continue
		}

		if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
			const binding = resolveImportBinding(context, jsxTagName(child))

			if (
				binding?.moduleName === `solid-js` &&
				binding.importedName === `Match`
			) {
				alternatives.push(
					analyzeSolidTransparentChildren(context, child, stack),
				)
				continue
			}
		}

		alternatives.push([
			opaque(`non-Match child in Solid Switch`, context.sourceFile, child),
		])
	}

	return alternatives
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

	const expression = initializer.expression
		? unwrapExpression(initializer.expression)
		: undefined

	if (expression && ts.isStringLiteralLikeNode(expression)) {
		return { kind: `literal`, tagName: expression.text }
	}

	if (
		expression &&
		ts.isIdentifier(expression) &&
		!hasShadowedBinding(context, expression) &&
		context.components.has(expression.text)
	) {
		return { kind: `local`, name: expression.text }
	}
}

function lowerSolidComponent(
	context: AnalyzeContext,
	node: ComponentJsxNode,
	stack: string[],
): StoryChild[] | undefined {
	const binding = resolveImportBinding(context, jsxTagName(node))

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
			const childrenProp = resolveJsxProp(
				context,
				node,
				`children`,
				SOLID_RENDER_PROPS,
			)
			if (
				!hasMeaningfulJsxChildren(jsxChildren(node)) &&
				(childrenProp.attribute || childrenProp.unknownSpread)
			) {
				alternatives.push([
					foreignOpaque(`Solid Switch render props`, context.sourceFile, node),
				])
			}

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
		const { attribute: componentAttribute, unknownSpread } = resolveJsxProp(
			context,
			node,
			`component`,
			SOLID_RENDER_PROPS,
		)
		const componentValue =
			componentAttribute && !unknownSpread
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
					analyzeSolidTransparentChildren(context, node, stack),
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
	const adoption = openingTagAdoptionRequest(context, node.openingElement)
	const tagName = getJsxTagText(context.sourceFile, node.openingElement.tagName)

	if (isFragmentJsxTag(context, node.openingElement.tagName)) {
		if (adoption) {
			invalidAdoptionTarget(
				context,
				adoption,
				`a fragment cannot be adopted; the target must be an imported component instance.`,
			)
		}
		return analyzeTransparentChildren(context, node, stack)
	}

	const assertedRootTagName = assertedForeignRootTagName(tagName)

	if (assertedRootTagName) {
		const componentName = assertedForeignComponentName(tagName)

		if (adoption) {
			adoptionFailure(
				context,
				componentName,
				adoption,
				`an intrinsic-root assertion supplies only shallow, unchecked root evidence.`,
			)
		}

		return [
			addressableForeignRoot(
				context,
				assertedRootTagName,
				componentName,
				node,
				node.openingElement.tagName,
			),
		]
	}

	if (tagName.includes(`.`)) {
		return analyzeComponentTag(context, tagName, node, stack, adoption)
	}

	if (!isIntrinsicJsxTag(tagName)) {
		return analyzeComponentTag(context, tagName, node, stack, adoption)
	}

	if (adoption) {
		invalidAdoptionTarget(
			context,
			adoption,
			`the target <${tagName}> is intrinsic; only an imported component instance can be adopted.`,
		)
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
	const adoption = openingTagAdoptionRequest(context, node)
	const tagName = getJsxTagText(context.sourceFile, node.tagName)

	if (isFragmentJsxTag(context, node.tagName)) {
		if (adoption) {
			invalidAdoptionTarget(
				context,
				adoption,
				`a fragment cannot be adopted; the target must be an imported component instance.`,
			)
		}
		return analyzeTransparentChildren(context, node, stack)
	}

	const assertedRootTagName = assertedForeignRootTagName(tagName)

	if (assertedRootTagName) {
		const componentName = assertedForeignComponentName(tagName)

		if (adoption) {
			adoptionFailure(
				context,
				componentName,
				adoption,
				`an intrinsic-root assertion supplies only shallow, unchecked root evidence.`,
			)
		}

		return [
			addressableForeignRoot(
				context,
				assertedRootTagName,
				componentName,
				node,
				node.tagName,
			),
		]
	}

	if (tagName.includes(`.`)) {
		return analyzeComponentTag(context, tagName, node, stack, adoption)
	}

	if (!isIntrinsicJsxTag(tagName)) {
		return analyzeComponentTag(context, tagName, node, stack, adoption)
	}

	if (adoption) {
		invalidAdoptionTarget(
			context,
			adoption,
			`the target <${tagName}> is intrinsic; only an imported component instance can be adopted.`,
		)
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
	adoption?: AdoptionRequest,
): StoryChild[] {
	if (hasShadowedBinding(context, jsxTagName(node))) {
		if (adoption) {
			invalidAdoptionTarget(
				context,
				adoption,
				`the target <${tagName}> is not bound to an import in this scope.`,
			)
		}
		return [
			foreignOpaque(
				tagName.includes(`.`)
					? `dynamic JSX component`
					: `imported or external component`,
				context.sourceFile,
				node,
				undefined,
				tagName,
			),
		]
	}
	const loweredChildren = lowerSolidComponent(context, node, stack)

	if (loweredChildren) {
		if (adoption) {
			invalidAdoptionTarget(
				context,
				adoption,
				`framework control-flow components cannot be adopted.`,
			)
		}
		return loweredChildren
	}

	const binding = resolveImportBinding(context, jsxTagName(node))

	if (binding) {
		const componentName = tagName.slice(tagName.lastIndexOf(`.`) + 1)
		const tagNameNode = ts.isJsxElement(node)
			? node.openingElement.tagName
			: node.tagName
		const adoptedStory = adoption
			? analyzeAdoptedForeignComponent(
					context,
					componentName,
					tagNameNode,
					adoption,
				)
			: undefined

		if (adoptedStory) return adoptedStory

		const resolvedRoots = analyzeForeignComponent(
			context,
			componentName,
			tagNameNode,
			node,
		)

		return (
			resolvedRoots ?? [
				externalComponentOpaque(
					context,
					`imported or external component`,
					node,
					componentName,
				),
			]
		)
	}

	if (adoption) {
		invalidAdoptionTarget(
			context,
			adoption,
			`the target <${tagName}> is not bound to an import.`,
		)
	}

	if (!isComponentName(tagName) || tagName.includes(`.`)) {
		return [
			foreignOpaque(
				`dynamic JSX component`,
				context.sourceFile,
				node,
				undefined,
				tagName,
			),
		]
	}

	if (!context.components.has(tagName)) {
		return [
			foreignOpaque(
				`imported or external component`,
				context.sourceFile,
				node,
				undefined,
				tagName,
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

function misplacedAdoptionDirective(
	context: AnalyzeContext,
	child: ts.JsxChild,
): boolean {
	if (!ts.isJsxExpression(child) || child.expression) return false

	const sourceText = context.sourceFile.text.slice(
		child.getStart(context.sourceFile),
		child.getEnd(),
	)
	const directiveCandidatePattern = new RegExp(
		String.raw`^\{\s*\/\*\s*${ADOPT_SUBTREE_DIRECTIVE}(?![\w-])`,
	)
	const legacyDirectiveCandidatePattern = new RegExp(
		String.raw`^\{\s*\/\*\s*${LEGACY_OWN_SUBTREE_DIRECTIVE}(?![\w-])`,
	)
	const range = rangeOf(context.sourceFile, child)

	if (legacyDirectiveCandidatePattern.test(sourceText)) {
		invalidAdoptionDirective(
			context,
			range,
			`${LEGACY_OWN_SUBTREE_DIRECTIVE} is no longer supported; place /* ${ADOPT_SUBTREE_DIRECTIVE} */ inside the component opening tag.`,
		)
		return true
	}

	if (!directiveCandidatePattern.test(sourceText)) return false

	invalidAdoptionDirective(
		context,
		range,
		`the directive must appear inside the target component's opening tag.`,
	)
	return true
}

function analyzeJsxChildren(
	context: AnalyzeContext,
	children: readonly ts.JsxChild[],
	stack: string[],
): StoryChild[] {
	return analyzeJsxChildrenWith(context, children, (child) =>
		analyzeJsxChild(context, child, stack),
	)
}

function analyzeJsxChildrenWith(
	context: AnalyzeContext,
	children: readonly ts.JsxChild[],
	analyzeChild: (child: ts.JsxChild) => StoryChild[],
): StoryChild[] {
	const storyChildren: StoryChild[] = []

	for (const child of children) {
		if (misplacedAdoptionDirective(context, child)) continue

		storyChildren.push(...analyzeChild(child))
	}

	return storyChildren
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
	expression = unwrapExpression(expression)

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
		expression.text === `undefined` &&
		resolveDeclarations(context, expression).length === 0
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
	use: (
		sourceFile: ts.SourceFile,
		typescriptAnalysis: TypescriptAstAnalysis,
	) => TResult,
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
	options: Pick<AnalyzeTsxOptions, "maxComponentDepth" | "typescriptSdkPath">,
	typescriptAnalysis: TypescriptAstAnalysis,
): AnalyzeContext {
	return {
		sourceFile,
		components: index.components,
		foreignComponentStack: new Set(),
		externalComponentOutput: new WeakSet(),
		resolvedDeclarations: new Map(),
		imports: index.imports,
		namespaceImports: index.namespaceImports,
		warnings,
		maxComponentDepth: options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH,
		...(options.typescriptSdkPath
			? { typescriptSdkPath: options.typescriptSdkPath }
			: {}),
		typescriptAnalysis,
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
	typescriptAnalysis: TypescriptAstAnalysis,
): RenderStory {
	const warnings: RenderStoryWarning[] = []
	const context = createAnalyzeContext(
		sourceFile,
		index,
		warnings,
		options,
		typescriptAnalysis,
	)
	const renderStory = {
		componentName,
		roots: analyzeComponent(context, componentName, []),
		warnings,
	}

	return options.scopeToCssClassRoots === false
		? renderStory
		: scopeRenderStoryToCssClassRoots(renderStory, {
				preserveUnknownRoots: (node) =>
					!context.externalComponentOutput.has(node),
			})
}

export function analyzeTsxRenderStory(
	options: AnalyzeTsxOptions,
	typescriptSession?: TypescriptAstSession,
): RenderStory {
	return withSourceFile(
		options,
		typescriptSession,
		(sourceFile, typescriptAnalysis) => {
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

			const context = createAnalyzeContext(
				sourceFile,
				index,
				warnings,
				options,
				typescriptAnalysis,
			)
			const renderStory = {
				componentName,
				roots: analyzeComponent(context, componentName, []),
				warnings,
			}

			return options.scopeToCssClassRoots === false
				? renderStory
				: scopeRenderStoryToCssClassRoots(renderStory, {
						preserveUnknownRoots: (node) =>
							!context.externalComponentOutput.has(node),
					})
		},
	)
}

export function analyzeTsxRenderStories(
	options: AnalyzeTsxRenderStoriesOptions,
	typescriptSession?: TypescriptAstSession,
): RenderStory[] {
	return withSourceFile(
		options,
		typescriptSession,
		(sourceFile, typescriptAnalysis) => {
			const index = collectComponentIndex(sourceFile)

			return selectComponentStories(index, options).map((componentName) =>
				analyzeIndexedComponent(
					sourceFile,
					index,
					componentName,
					options,
					typescriptAnalysis,
				),
			)
		},
	)
}
