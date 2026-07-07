export type SourceRange = {
	start: number
	end: number
}

export type StoryChild = StoryNode | OpaqueStoryNode

export type StoryNode = {
	kind: `element`
	tagName: string
	children: StoryChild[]
	range?: SourceRange
}

export type OpaqueStoryNode = {
	kind: `opaque`
	reason: string
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
	code: `dead-selector` | `impossible-local-class`
	message: string
	selector: string
	range?: SourceRange
}
