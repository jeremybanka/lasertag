export type SourceRange = {
	start: number
	end: number
}

export type StoryChild = StoryNode | OpaqueStoryNode | StoryChoiceNode

export type StoryAttribute = {
	expression?: string
	name: string
	value?: string
	range?: SourceRange
	valueRange?: SourceRange
}

export type StoryNode = {
	kind: `element`
	tagName: string
	children: StoryChild[]
	addressable?: true
	attributes?: StoryAttribute[]
	componentName?: string
	ownership?: `foreign`
	range?: SourceRange
	sourcePath?: string
}

export type OpaqueStoryNode = {
	kind: `opaque`
	reason: string
	componentName?: string
	expectedRootTagName?: string
	ownership?: `foreign`
	range?: SourceRange
	sourcePath?: string
}

export type StoryChoiceNode = {
	alternatives: StoryChild[][]
	kind: `choice`
	range?: SourceRange
	sourcePath?: string
}

export type RenderStory = {
	componentName: string
	roots: StoryChild[]
	warnings: RenderStoryWarning[]
}

export type RenderStoryWarning = {
	code:
		| `adoption-source-unavailable`
		| `component-cycle`
		| `component-not-found`
		| `invalid-adoption-directive`
		| `invalid-adoption-target`
		| `multiple-main-components`
		| `unknown-expression`
	message: string
	range?: SourceRange
	sourcePath?: string
}

export type SelectorRelation = `self` | `child` | `descendant`

export type SelectorPathSegment = {
	relation: SelectorRelation
	tagName: string
}

export type SelectorPath = SelectorPathSegment[]

export type Reachability = `reachable` | `unreachable` | `unknown`

export type CssReachabilityDiagnostic = {
	code:
		| `adoption-source-unavailable`
		| `dead-selector`
		| `disable-explanation-too-short`
		| `expect-error-explanation-too-short`
		| `impossible-local-class`
		| `invalid-adoption-directive`
		| `invalid-adoption-target`
		| `opaque-component-root-may-collide`
		| `selector-matches-foreign-component-root`
		| `selector-crosses-ownership-boundary`
		| `unused-disable`
		| `unused-enable`
		| `unused-expect-error`
	message: string
	selector: string
	storyEvidence?: RenderStoryEvidence
	range?: SourceRange
	renderSourcePath?: string
	renderSourceRange?: SourceRange
}

export type RenderStoryEvidence = {
	possibilities: RenderStoryEvidencePossibility[]
	selectorPath: SelectorPath
}

export type RenderStoryEvidencePossibility = {
	closestPath: string[]
	matchedSegments: number
	roots: StoryChild[]
}
