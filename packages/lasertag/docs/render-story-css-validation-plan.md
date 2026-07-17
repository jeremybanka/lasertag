# Render Story CSS Validation Plan

Status: planning

## Idea

Validate a component-owned `.module.css` file against the JSX that its sibling
component file can actually render.

For a CSS module such as `AppPanel.module.css`, the analyzer looks at the
corresponding `AppPanel.tsx` file, finds the main exported component, builds a
static model of the tag trees that component can render, and checks each nested
selector against that model. If no possible render story contains the selector's
tag path, the selector is dead CSS.

This feature would start as a TypeScript analyzer that can be used by a linter,
a CLI, and an LSP. The LSP is the best long-term interface because the feedback
belongs beside the stylesheet while a component is being edited.

## Why This Fits Lasertag

lasertag already asks components and stylesheets to tell the same structural
story:

- one component file owns one sibling `.module.css` file
- the module exposes only `css.class`
- the root JSX tag carries that class
- nested CSS uses tag selectors and child relationships to mirror JSX
- imported component internals are not part of the local stylesheet contract

That makes lasertag unusually well suited to static CSS reachability. A generic
CSS linter has to guess whether `.card .title` is meaningful. A lasertag-aware
analyzer can ask a sharper question: can this component ever render this tag path
under its styled root?

## Terms

Main component: The exported component whose sibling `.module.css` file is being
validated. The default should be the export matching the file stem. If the file
has exactly one exported component, the analyzer can use that as a fallback.

Render story: A conservative static model of every tag tree the main component
can render from code that lives in the same file.

Local component: A JSX component whose implementation is declared in the same
file as the main component. Local components can be inlined into the render
story.

Opaque component: A JSX component whose implementation is imported, dynamic, or
otherwise not available in the same file. Opaque components are boundaries. Their
internal render trees are not inspected by this analyzer.

Reachable selector: A selector whose structural path can match at least one path
inside the render story.

Dead selector: A selector whose structural path cannot match any supported
render story path.

## Guiding Rule

Prefer false negatives over false positives.

If the analyzer cannot confidently model a TSX construct or a CSS selector, it
should mark that section as unknown and avoid reporting dead CSS from it. A dead
CSS diagnostic should mean the tool can prove the selector is unreachable inside
the supported static subset.

## Example

```tsx
import css from "./AppPanel.module.css"

const PanelActions = () => (
	<actions-row>
		<button type="button">Save</button>
	</actions-row>
)

export function AppPanel({ showActions }: { showActions: boolean }) {
	return (
		<app-panel className={css.class}>
			<header>
				<h1>Project</h1>
			</header>
			{showActions ? <PanelActions /> : null}
		</app-panel>
	)
}
```

```css
app-panel.class {
	> header {
		> h1 {}
	}

	> actions-row {
		> button {}
	}

	> footer {}
}
```

The render story contains:

- `app-panel > header > h1`
- `app-panel > actions-row > button`

The `> footer` selector is dead because no supported render story contains an
`app-panel > footer` path.

## Render Story Model

The analyzer should build a graph rather than materializing every complete tree.
That keeps conditionals, repeated children, and local component calls from
creating avoidable combinatorial growth.

Each render node should track:

- tag name, such as `app-panel`, `header`, or `button`
- child relationships
- alternate branches
- repeated branches
- source range in the TSX file
- whether a subtree is known, empty, or opaque

The first useful API can be path-oriented:

```ts
type RenderStory = {
	root: StoryNode
	canReach(path: SelectorPath): ReachabilityResult
}
```

The CSS validator does not need to ask whether a complete tree is possible for
MVP diagnostics. It mostly needs to ask whether a selector path can exist under
the root.

## TSX Analysis

Supported in the MVP:

- function declarations
- function expressions and arrow functions assigned to local constants
- named exports and default exports
- return statements from component bodies
- JSX elements with intrinsic tag names
- JSX fragments as transparent containers
- local component calls, inlined recursively
- conditional expressions
- logical `&&` expressions as optional branches
- `null`, `false`, and `undefined` as empty render branches
- arrays and simple array literals as sibling groups
- simple `.map(...)` callbacks as repeated branches when the callback returns JSX
- selected framework control components, such as Solid's `Show`, `For`, `Switch`,
  and `Match`

Useful next step:

- local constants that hold JSX
- helper functions that return JSX and are called from JSX expressions
- switch statements and early returns
- React/Preact fragments imported under aliases

Unsupported or opaque at first:

- imported components
- dynamic components such as `<Tag />`
- member expression components such as `<Menu.Item />`
- render props
- arbitrary function calls inside JSX
- `props.children`
- portals
- code outside the sibling TSX file

Opaque does not mean dead. It means the analyzer stops expanding that branch.
Selectors that depend on opaque internals should not receive dead-code
diagnostics unless the selector is impossible before the opaque boundary.

## Component Boundaries

The strict interpretation is: only inline components declared in the same file.
Imported components are outside the render story.

There is one tempting extension: infer an imported component's root tag from its
component name, because lasertag convention says `UserMenu` should render
`<user-menu>`. That could make selectors such as `> user-menu` validate without
opening `UserMenu.tsx`.

This should be a separate mode, not the default MVP. The default should validate
only what the current file proves. Convention-based imported-root inference is
useful, but it is a different confidence level than same-file JSX.

## CSS Analysis

The CSS side should parse the module, expand nested selectors into their full
selector chains, and normalize each selector into a structural path.

Supported in the MVP:

- top-level root selector such as `app-panel.class`
- nested selectors using `&`
- type selectors
- child combinator `>`
- descendant combinator
- selector lists
- `:is(...)` and `:where(...)` as selector alternatives
- pseudo-classes such as `:hover` and `:focus-visible` as refinements on an
  otherwise reachable host
- pseudo-elements such as `::before` and `::after` as refinements on an otherwise
  reachable host
- `:global(...)` as an explicit external escape

Unsupported at first:

- sibling combinators `+` and `~`
- `:has(...)`
- namespace selectors
- complex attribute reasoning
- CSS generated by preprocessors before it reaches the module file

Unsupported selector pieces should produce an unknown result for that selector,
not a dead-code diagnostic.

## CSS Modules Rules

The analyzer should preserve lasertag's CSS Modules assumptions:

- `.class` is the only local class exported by the module
- the root selector uses that class
- nested local classes are unreachable because JSX cannot reference them through
  `css`
- external classes are addressable only through `:global(...)`
- tag selectors are not scoped by CSS Modules and can be checked structurally

Examples:

```css
app-panel.class {
	> .label {}
	> :global(.third-party-label) {}
}
```

`> .label` is dead under lasertag's module contract. The component can only apply
`css.class`; it cannot apply a generated local class named `label`.

`> :global(.third-party-label)` is not locally provable from tags alone. It
should be considered reachable only if the render story contains an opaque branch
or an explicit tag path where external DOM can plausibly appear. Otherwise it
should be reported as unreachable.

## Diagnostics

Primary diagnostics:

- dead selector path
- impossible local class selector
- selector rooted outside the component root
- CSS module root does not match the rendered root tag
- CSS module contains no selector for the rendered root

Secondary diagnostics:

- selector skipped because it uses unsupported CSS
- render branch skipped because it uses unsupported TSX
- imported component treated as opaque
- multiple possible main components found

The LSP should surface primary diagnostics as warnings. Secondary diagnostics
should probably be hints or disabled by default until they are genuinely helpful.

## Suggested Architecture

Create one shared analyzer package inside the lasertag package before building
tooling around it:

```text
packages/lasertag/
	eslint/
	src/
		render-story/
			analyze-tsx.ts
			analyze-css-module.ts
			validate-css-reachability.ts
			diagnostics.ts
```

The shared analyzer should expose a small API:

```ts
type ValidateCssModuleOptions = {
	tsxPath: string
	cssPath: string
	readFile: (path: string) => Promise<string> | string
}

type ValidateCssModuleResult = {
	diagnostics: LasertagDiagnostic[]
	renderStory?: RenderStory
}
```

From there, add integrations:

- ESLint rule for editor setups that already use lasertag's plugin
- CLI command for CI and one-off checks
- LSP server for live CSS diagnostics and cross-file navigation

The analyzer should not be tied to ESLint's rule context. ESLint is one consumer,
not the core.

## Performance And Dependency Bets

The first performance assumption should be that render-story expansion is more
dangerous than parsing. A parser can probably read a typical component module
quickly. The expensive mistake would be materializing every possible tree from
conditionals, optional branches, maps, and local component calls.

Early implementation decisions:

- represent the render story as a graph or trie, not as a list of concrete trees
- make CSS selector checks path queries against that graph
- short-circuit recursion and repeated structures with explicit cycle and depth
  budgets
- treat over-budget branches as unknown instead of trying to be heroic
- cache by document version and content hash
- invalidate TSX and CSS independently
- in LSP mode, debounce diagnostics and prioritize the currently open file pair

The TSX parser should start in the cheap syntax-only lane. The analyzer mostly
needs exported declarations, local bindings, returns, JSX tags, JSX expressions,
and source ranges. It does not need typechecking for the MVP.

Good first choices:

- TypeScript compiler API when the analyzer owns parsing
- `@typescript-eslint/typescript-estree` when an ESTree-shaped AST makes ESLint
  integration simpler
- an existing ESLint AST from `context.sourceCode.ast` when running inside an
  ESLint rule

Avoid creating a TypeScript `Program` or type checker unless a future feature
proves it needs semantic information. Type-aware parsing has real startup and
cache costs, and most render-story questions are syntactic.

Tree-sitter is attractive for editor-grade incremental parsing, but it should not
be the first dependency. It would make sense if the LSP eventually spends most of
its time reparsing open TSX documents. It does not remove the harder work:
resolving local JSX component identifiers to same-file declarations, reading
their return paths, and building a bounded reachability model.

The CSS parser has a different shape. It needs modern CSS, nesting, selector
structure, source ranges, and ideally CSS Modules awareness. Lightning CSS is a
strong candidate because its Node API already parses modern CSS and exposes a
typed visitor API, including selectors. The main thing to verify before choosing
it is source-location quality for nested selector diagnostics.

If Lightning CSS cannot provide the selector ranges needed for good editor
feedback, the fallback should be a PostCSS-based stack with a selector parser.
That path is less elegant, but it is mature and gives direct control over
diagnostic locations.

WASM should not be the default early choice. It adds initialization and packaging
complexity, and the Lightning CSS WASM build does not expose all of the Node
visitor APIs. WASM becomes interesting only after profiling shows parser time is
the bottleneck and the WASM parser exposes the exact AST and range data the
analyzer needs.

Recommended MVP dependency posture:

- TSX: TypeScript compiler API or `@typescript-eslint/typescript-estree`
- CSS: Lightning CSS Node API if selector locations are good; otherwise PostCSS
  plus a selector parser
- no Tree-sitter yet
- no WASM yet
- no type-aware TypeScript Program yet

Benchmark the analyzer around the real unit of work: one `.tsx` file, its sibling
`.module.css` file, and an LSP edit loop. Useful measurements:

- cold analysis of one file pair
- warm analysis after CSS-only edits
- warm analysis after TSX-only edits
- behavior on a component with many local components
- behavior on deeply nested conditionals
- behavior when recursion, dynamic tags, or unsupported selectors force unknown
  boundaries

## Milestones

1. Render story prototype

Build TSX parsing and path reachability for a single file. Support intrinsic
tags, fragments, local components, returns, conditionals, and optional branches.
Snapshot the resulting story for fixtures.

2. CSS selector prototype

Parse `.module.css`, flatten nested selectors, convert supported selectors to
path queries, and attach source ranges to selector nodes.

3. Dead selector diagnostics

Compare selector paths with render stories. Emit diagnostics for unreachable tag
paths and impossible local classes. Keep unsupported constructs quiet.

4. Lasertag root validation

Connect this analyzer to existing lasertag assumptions: own CSS module import,
single exported `class`, root class placement, and root tag naming.

5. ESLint integration

Add an ESLint rule that reports CSS reachability from the TSX file, or from the
CSS file if the rule runner has access to both source texts.

6. LSP integration

Add live diagnostics in `.module.css`, plus useful editor affordances:

- jump from selector segment to JSX tag source
- show the matched render paths for a selector
- show skipped branches when analysis became opaque

## Test Fixtures

Good initial fixtures:

- direct child selector matches direct JSX child
- direct child selector does not match nested grandchild
- descendant selector matches nested grandchild
- conditional branch makes both alternatives reachable
- `&&` branch makes a selector reachable
- local component is inlined
- imported component is opaque
- fragment is transparent
- array literal children are reachable
- `.map(...)` callback children are reachable
- local nested class is dead
- `:global(.external)` is allowed only across an external or opaque boundary
- unsupported selector does not produce a dead diagnostic
- unsupported TSX branch does not produce a dead diagnostic

## Open Questions

- How should the analyzer choose the main component when the file stem and export
  name disagree?
- Should imported-root inference from component names be available, and should it
  be opt-in or recommended?
- Should `props.children` create an opaque hole under the current component, or
  should lasertag discourage styling children passed from outside?
- Should missing CSS for rendered tags ever be reported, or is the tool only for
  deleting unreachable CSS?
- How much attribute analysis is worth supporting, especially for
  `[data-state="open"]` and ARIA selectors?
- Should this live as an ESLint rule first, or should the LSP/CLI shape force the
  core API from day one?

## Thoughts

This is a strong direction for lasertag because it turns the project's naming and
nesting conventions into a practical maintenance tool. The payoff is not just
"unused CSS" detection. It is making the stylesheet accountable to the component
shape that supposedly owns it.

The main design risk is overclaiming. Static TSX analysis can get impossible
quickly if the tool tries to understand arbitrary JavaScript. The tool will feel
trustworthy if it has a small, well-documented supported subset and treats
everything else as unknown.

The second risk is imported components. Opening the world would make diagnostics
expensive and surprising. Keeping analysis file-local preserves the mental model:
this CSS module describes this component's own render story. If a component wants
to style structure around an imported component, it should render local wrapper
tags that the story can see.

The best MVP is therefore narrow but real: prove dead nested selectors inside one
component module, using only same-file JSX and lasertag's existing CSS Modules
rules. Once that is solid, LSP features like "show matching JSX path" become the
part that makes the idea feel alive in daily use.
