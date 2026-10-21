# Render Story CSS Validation Plan

Status: implemented with opt-in CSS ownership analysis; historical design notes follow.

## CSS mapper ownership analysis

The source module `src/refractor/css-ownership-evidence.ts` supplies CSS Module
ownership evidence to CLI `check --css-ownership` and `fix --css-ownership`, and
to the LSP with `cssOwnership.enabled` and `runExternalCode` enabled. VS Code
exposes the trusted-workspace setting `lasertag.css.ownership.enabled`.
See the [consumer setup and output contract](tooling-guide.md#css-mapper-ownership-analysis).

The consumers reuse a bounded analysis process and TypeScript session, including
current unsaved overlays and explicit invalidation. TSX stories and evidence
share parsed source; the template parser remains authoritative for Astro
structure. Mapper results are consumed by CLI reporting and the editor's
render-story view. Existing structural rules still determine CSS diagnostics,
completions, and cleanup. Worker failures fall back to ordinary extraction.
The implementation remains outside the `lasertag/refractor` exports.

Development validation pins `css-modules-content-mapper` `0.1.1` and runs its
unmodified executable. Astro inputs also use `@astrojs/ts-content-mapper` `0.2.0`.
The CSS mapper's generated `readonly class` declaration is mapped back to the
authored stylesheet. Generated ambient scaffolding alone is not an ambient-only
result: an actual content-mapped CSS property can establish stylesheet provenance.
A plain `declare module "*.module.css"` declaration cannot.

To inspect a file in a trusted, configured project:

```sh
node scripts/inspect-css-ownership.node.ts --runExternalCode path/to/AppPanel.tsx
```

The same command accepts `.astro`. Register the CSS mapper for `.module.css` in
the project's `contentMappers` array; Astro also needs its own mapper. These
experimental commands require explicit permission to execute project mappers.
The benchmark below creates that configuration only in a temporary copy.

Results contain the ordinary `renderStory` and separate `ownership` evidence.
For `.class` property or literal bracket accesses inside `class`, `className`,
or `class:list` expressions, the evidence records authored UTF-16 ranges,
the resolved declaration path, and its relationship to the expected sibling:

| Status                     | Meaning                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sibling`                  | A mapped local `.class` token and binding provenance identify the expected stylesheet.               |
| `foreign`                  | The same checks identify another stylesheet.                                                         |
| `ambient` / `non-css`      | The declaration supplies a type or another source binding, without mapped CSS evidence.              |
| `unmapped` / `unverified`  | A projection lacks usable Definition mappings, or its authored token or receiver cannot be verified. |
| `unresolved` / `ambiguous` | Resolution fails or the available targets disagree.                                                  |

`usage: "expression"` distinguishes a reference in a conditional, array or mixed
expression from a direct attribute reference. Neither status proves that a
particular branch renders or that an arbitrary expression applies the class.
`legacyExpressionRecognized` records what the current textual attachment policy
recognizes; differences are evidence for future review, not behavior changes.
An overall `available` status means the input could be analyzed, not that every
reference has verified CSS evidence.

The analysis verifies the authored token as well as the mapper's symbol. The
generic mapper exports IDs and names inside global selectors; those are not
sibling ownership proof. Comments, attribute strings, partial names, escaped
tokens, missing or feature-disabled mappings, and stale CSS source are rejected
or left unverified. Selectors involving `:global` are conservatively unverified,
including local tokens alongside a global selector.

Validation also found that TypeScript can collapse a conditional choice between
structurally identical CSS Module export types and return only one property's
declaration. Receiver provenance now follows imports and constant aliases,
preserves ambiguous conditional origins, and leaves mutable bindings, asserted
objects, and declaration-only values unverified. A type match cannot independently
establish runtime stylesheet identity.

Private tests exercise real TSX and Astro mappings, aliases, barrels, namespaces,
path mappings, optional and bracket accesses, shadowing, different modules,
unsaved CSS and import edits, closing overlays, disk changes, ambiguous types,
mapper failures, and deliberately defective projections. The `.class`-only rule
still diagnoses other local classes even though the generic development mapper
can expose them to TypeScript. This analysis does not adopt imported DOM, infer
selector reachability from a class symbol, or replace the CSS parser.

Run the repeatable website validation from the repository root:

```sh
pnpm --silent --filter lasertag benchmark:css --runExternalCode --iterations 5
```

It copies the site's inputs into a temporary project, enables both mappers there,
and checks every sibling pair. Assertions compare stories, CSS diagnostics,
completion results and cleanup ranges with ordinary analysis, account for every
conventional `css.class` reference, and verify authored CSS locations. The JSON
report includes versions, a source-content hash, per-reference evidence, and
median/p95 timing samples. Timings include ordinary story extraction plus evidence
collection, with verification and fixture copying outside the timers. The shared
session corpus workload switches files. Separate warmed-session workloads measure
at least thirty unique TSX edits, import renames, Astro edits, unsaved CSS edits,
alternating edited documents, and unchanged requests. Their timed analysis includes
story extraction, ownership evidence, diagnostics, completion results, and cleanup
ranges; it excludes correctness comparisons, editor debounce and LSP transport.

The initial two-pass 2026-10-20 run on Linux ARM64 with Node `26.10.0`, TypeScript `7.1.0-beta`,
CSS mapper `0.1.1` and Astro mapper `0.2.0` checked eleven sibling pairs: eight
TSX and three Astro. All eleven conventional references resolved to the expected
sibling `.class` token. Every story, diagnostic set, completion result, and
cleanup range matched ordinary analysis. The corpus hash was
`93589980682d9e98fe7785aeda19370c1151581b89b6900d101d9abbae1caba6`.

| Entire eleven-file scan                              | Median (ms) | p95 (ms) |
| ---------------------------------------------------- | ----------- | -------- |
| Ordinary story extraction                            | 968.0       | 1111.6   |
| Story plus evidence, fresh semantic session per file | 3074.4      | 3218.7   |
| Story plus evidence, shared semantic session         | 2093.5      | 2152.4   |

Each row has five samples with warm OS/package caches. The evidence path also
computes an ordinary story with mapper execution disabled, so these numbers
include the current separation between story generation and semantic evidence.
Session reuse reduces startup work, but the experiment still adds substantial
cost. These initial measurements preceded the incremental changes described below.
The demonstrated gain is verified stylesheet binding and identification of
cases the textual policy cannot distinguish. It does not justify changing public
ownership decisions or enabling mappers on the default analysis path.

### Incremental extraction and project state

TSX stories and CSS evidence now share the same parsed native source and project
analysis. A small session adapter invokes the existing public story extractor
without opening another compiler session. If a story query encounters a mapped
component declaration, it falls back to ordinary analysis so generated framework
scaffolding cannot change public render semantics. Astro stories continue to use
their template parser.

Ordinary root switches and source/CSS overlay edits update the current snapshot.
Closed overlays are explicitly restored from disk or marked missing, and restored
disk copies are refreshed on subsequent requests. Dependency observations survive
intervening files; edits to an earlier root's imports cannot be hidden by querying
another document. New roots notify native config-glob discovery. Configuration
changes and explicit full invalidations still start fresh snapshots.

Lifecycle tests assert one native API and one initial snapshot for a multi-file
story/evidence sequence. Regression tests cover extended config changes, separate
JSX configurations, closed missing overlays, later disk creation/deletion,
dependency edits across intervening roots, and the generated-component fallback.

The final run used the same versions, eleven-file corpus and content hash as the
initial run above. Five corpus samples measured the following:

| Entire eleven-file scan                         | Median (ms) | p95 (ms) |
| ----------------------------------------------- | ----------- | -------- |
| Ordinary extraction, fresh session per TSX file | 1090.7      | 1363.7   |
| Ordinary extraction, shared session             | 36.7        | 305.8    |
| Story plus evidence, fresh session per file     | 2450.0      | 2929.7   |
| Story plus evidence, shared session             | 76.9        | 502.4    |

The shared-session corpus rows include initial project loading in the first
sample, which dominates their p95. Their medians predominantly represent retained
project state. The previous two-pass shared scan took 2093.5 ms median; the final
combined scan took 76.9 ms. The matched ordinary shared scan shows that evidence
still adds work even after duplicated analysis and startup work are removed.

The edit measurements below use thirty samples per workload. Each path analyzes
the original document before timing begins. Every timed edit supplies unique source text
or CSS; the unchanged workload deliberately repeats identical text. Baseline
generation, correctness assertions and fixture work are outside the timed calls.
Both paths include story extraction, CSS diagnostics, completions and cleanup;
the evidence path also resolves and validates stylesheet ownership references.

| Workload                         | Ordinary median (ms) | With evidence median (ms) | With evidence p95 (ms) |
| -------------------------------- | -------------------- | ------------------------- | ---------------------- |
| Unchanged TSX request            | 2.0                  | 3.2                       | 3.7                    |
| TSX render edit                  | 20.3                 | 34.9                      | 75.0                   |
| TSX import rename                | 24.7                 | 23.9                      | 41.1                   |
| Astro render edit                | 7.9                  | 39.9                      | 53.2                   |
| Unsaved CSS edit                 | 2.4                  | 8.9                       | 10.0                   |
| Alternating edited TSX documents | 18.4                 | 22.3                      | 37.1                   |

TSX samples use `ResponsiveNavPanel.tsx`, alternating with `ToggleButton.tsx` in
the final workload. Astro samples edit `Layout.astro`. Every edited result matched
ordinary stories and CSS outputs, and every reference retained the expected CSS
identity and current authored range. The ordinary and evidence groups run
separately on a shared host; small timing differences, such as the import-rename
medians, should not be read as evidence being faster. These measurements exclude
editor debounce and LSP transport, and do not establish latency for other projects
or the exceptional mapped-component fallback. Fresh-session startup remains
expensive; callers need to retain sessions.

### Comparison with release 0.8.7

A separate run used the tagged 0.8.7 source with its original TypeScript 7.0.2
dependency against the same eleven-file corpus. Five corpus samples and thirty
samples per edit workload produced these medians; current prototype measurements
include ownership evidence.

| Workload                 | Release 0.8.7 (ms) | Current prototype (ms) |
| ------------------------ | ------------------ | ---------------------- |
| Shared-session corpus    | 3242.7             | 73.6                   |
| TSX render edit          | 406.7              | 24.2                   |
| TSX import rename        | 409.7              | 19.4                   |
| Astro render edit        | 8.1                | 37.9                   |
| CSS edit with reanalysis | 396.3              | 8.2                    |

The corpus stories and CSS results matched. Alternating edited documents exposed
stale stories in 29 of 30 release samples, so those timings are excluded. Current
alternating results matched fresh analysis. These are analysis benchmarks on the
same shared Linux ARM64 host, not complete editor or navigation timings. The
reuse improvements benefit TypeScript extraction; Astro ownership evidence adds
work beyond its existing template parser.

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

Imported component DOM remains foreign to the host stylesheet, but its outer
node does not have to remain opaque when the program provides direct evidence.
Refractor follows the imported symbol through TypeScript module resolution and
re-exports. If the resolved implementation has supported return branches, their
outer JSX nodes become concrete foreign roots. Selectors that match those roots
receive a verified foreign-root diagnostic, and selectors that descend farther
cross the ownership boundary.

Component names are never evidence of rendered roots. Lasertag convention may
say that `UserMenu` should render `<user-menu>`, but an imported library is not
required to follow that convention. If module resolution fails, resolves only a
declaration, or reaches an unsupported implementation shape, the component
stays opaque and receives possible-collision diagnostics instead.

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
