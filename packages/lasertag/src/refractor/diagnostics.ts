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
	attributes?: StoryAttribute[]
	ownership?: `foreign`
	range?: SourceRange
}

export type OpaqueStoryNode = {
	kind: `opaque`
	reason: string
	expectedRootTagName?: string
	ownership?: `foreign`
	range?: SourceRange
}

export type StoryChoiceNode = {
	alternatives: StoryChild[][]
	kind: `choice`
	range?: SourceRange
}

export type RenderStory = {
	componentName: string
	roots: StoryChild[]
	warnings: RenderStoryWarning[]
}

export type RenderStoryWarning = {
	code:
		| `component-cycle`
		| `component-not-found`
		| `multiple-main-components`
		| `unknown-expression`
	message: string
	range?: SourceRange
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
		| `dead-selector`
		| `disable-explanation-too-short`
		| `expect-error-explanation-too-short`
		| `impossible-local-class`
		| `selector-crosses-ownership-boundary`
		| `unused-disable`
		| `unused-enable`
		| `unused-expect-error`
	message: string
	selector: string
	storyEvidence?: RenderStoryEvidence
	range?: SourceRange
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
