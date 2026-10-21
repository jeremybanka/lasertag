# Astro Support Plan

## TypeScript 7.1 semantic integration

The workspace uses TypeScript `7.1.0-beta`. The internal source module
`src/refractor/astro-semantic-evidence.ts` combines the existing Astro template
story with separate component-reference evidence from a configured content mapper.
It remains outside the `lasertag/refractor` exports. Public render stories and CSS decisions continue to use the
template analyzer. The LSP now consumes the semantic evidence for on-demand component navigation using
the project’s TypeScript mapper configuration; see the
[editor setup](tooling-guide.md#astro-component-navigation).

From the repository root, inspect an Astro file in a trusted project with an
installed mapper registered for `.astro` in `tsconfig.json`:

```sh
node scripts/inspect-astro-semantics.node.ts --runExternalCode path/to/AppPanel.astro
```

The inspector flag permits TypeScript to execute the project's configured mapper.
The shipped CLI and trusted LSP automatically permit configured mappers; restricted
editor workspaces retain structural analysis without executing them. Lasertag does
not configure consumer projects. Validation pins `@astrojs/ts-content-mapper`
`0.2.0` as a development dependency and runs its unmodified process. The smaller
protocol fixture remains useful for testing conflicting mappings and failures.

The JSON result contains `renderStory` and `semantics`. Semantic evidence identifies
authored component names and their resolved declaration files, classified as
`source` or `ambient`, with source ranges where the mapping supports them. Ranges
use UTF-16 offsets. Astro's UTF-8 parser
offsets are converted before querying TypeScript's span maps. Aliased imports and
namespace members are resolved through the checker. Multiple projections must
agree; conflicting, absent, and unresolved projections are reported explicitly.

Mapper output may contain type-checking scaffolding and supplemental script files.
Neither contributes DOM structure or ownership facts. Component identities do not
prove a root tag, slot behavior, or subtree adoption. Mapper crashes, parse errors,
empty transforms, missing configuration, and disabled execution produce unavailable
semantic evidence while retaining the template story. No semantic failure becomes
an empty render story or authorizes CSS removal.

Implementation coverage lives under `tests/private/refractor/`. Public navigation
protocol tests live under `tests/public/lsp/`; process and session lifecycle tests
live under `tests/private/lsp/`. A resolved symbol
identifies a TypeScript declaration, which can be an ambient type declaration or a
local variable holding a dynamic component. It does not necessarily identify a
component implementation. Structural changes require separate evidence and
contract review.

### Official mapper validation

The [Astro-maintained mapper](https://github.com/withastro/astro/tree/main/packages/language-tools/ts-content-mapper)
is exercised by `astro-official-mapper.test.ts`. The tests check path aliases,
barrel re-exports, namespace members, default Astro imports, named frontmatter
exports, Unicode and CRLF ranges, standalone roots, fragments, expression islands,
ambient declarations, dynamic bindings, missing imports, unsaved edits, dependency
changes, syntax errors, and disabled execution. Stories and CSS diagnostics remain
those of the template analyzer, including slots, hydration and injected HTML.

Validation found and fixed two prototype problems:

- A standalone self-closing component can have a parser position at its name,
  while nested and paired components start at `<`. Verify either authored anchor
  before mapping it; otherwise components such as the site's `<CodeBlock />` are
  silently omitted.
- A reused TypeScript session could retain a failed module lookup after a missing
  file was created or a deleted file restored. Unresolved symbol queries now
  trigger fresh project discovery on the next analysis. This adds work while a
  dependency remains unresolved.

The repeatable corpus benchmark copies `apps/lasertagcss.com` inputs into a
temporary project and enables the mapper there. It leaves the site's configuration
unchanged and cleans up the copy. Run from the repository root:

```sh
pnpm --silent --filter lasertag benchmark:astro --runExternalCode --iterations 10
```

Its JSON output includes tool versions, a source-content hash, every component
reference and target, source versus ambient-declaration counts, and timing samples
summarized as median and p95. It asserts that every parser component is accounted
for, authored ranges stay within their sources, all stories match the parser, and
sibling CSS diagnostics match the public analyzer. Repeated requests and unsaved
edits of the home page are measured separately from scanning across files.

The 2026-10-20 run used Node `26.10.0` on Linux ARM64, TypeScript `7.1.0-beta`,
mapper `0.2.0`, and its locked `@astrojs/astro2tsx` `0.1.3` dependency. The 15-file
website corpus contained 29 component references and three sibling CSS pairs:

| Evidence                               | References |
| -------------------------------------- | ---------- |
| Source declaration with authored range | 5          |
| Astro source file, without a range     | 14         |
| Ambient type declaration only          | 10         |
| Unresolved or omitted                  | 0          |

The ten MDX `<Content>` references lead to Astro's `client.d.ts`, not the MDX
implementation. The other 19 references lead to the expected local TSX/Astro
components or Astro's `ClientRouter.astro`. Every story and all three CSS
diagnostic sets matched the public analyzer.

| Workload                         | Median (ms) | p95 (ms) |
| -------------------------------- | ----------- | -------- |
| Template-only scan, 15 files     | 17.8        | 20.2     |
| Mapper scan, new session         | 1658.0      | 1720.4   |
| Mapper scan, reused session      | 1640.3      | 1692.2   |
| Home page, new session           | 178.8       | 437.9    |
| Home page, repeated request      | 13.6        | 15.3     |
| Home page, unsaved trailing edit | 30.6        | 46.8     |

Each row has ten samples. New sessions include compiler/mapper startup with warm
OS and package caches; disposal, correctness assertions and fixture copying are
outside the timers. The mapped path includes template parsing and semantic
evidence collection. Full scans switch the open root for each file; repeated
requests reuse the same root. This measures the current prototype and one
repository on one machine, not a framework-wide performance guarantee. The source
hash for this run is
`1f79539fe912ab5965351038280e60eb5d39cc0841543bd7fb62b06c3307f610`.

The demonstrated improvement is component identity and navigation evidence that
survives authored aliases and does not depend on component naming conventions.
The LSP now exposes that evidence through automatic configured navigation. Go to Definition
returns source targets; Go to Declaration returns ambient targets, including
`declare` declarations in ordinary TypeScript files. A separate process reuses
the native compiler session, supplies current unsaved documents, discards stale
responses, and releases a hung mapper after a bounded timeout. Public protocol
tests verify navigation and unchanged stories, completions, and cleanup edits.
The timings above measure the synchronous prototype, not end-to-end LSP latency;
broader project and editor performance measurements remain useful follow-up work.
Semantic evidence does not improve DOM inference or selector reachability.
Existing render-story naming assumptions require a separate contract decision.

Astro support should be treated as another render-story source adapter, not as a
new reachability engine.

The current refractor pipeline already separates the two important halves:

- source analysis turns a component file into a `RenderStory`
- CSS analysis turns a `.module.css` file into selector paths and asks whether
  those paths are reachable in that story

For `.astro`, the main task is therefore:

```text
Astro source -> RenderStory
```

Once that exists, the existing selector analysis, reachability checks, CLI
reporting, LSP diagnostics, and VSCode packaging can keep doing the same job.

## Target Shape

For a sibling pair like this:

```text
AppPanel.astro
AppPanel.module.css
```

lasertag should parse `AppPanel.astro`, read its template body, normalize the
template into a `RenderStory`, and validate `AppPanel.module.css` against that
story.

HTML tags and custom elements map directly to story elements. Fragments and
multiple top-level nodes can be represented by multiple roots. Imported Astro,
framework, or web components should be treated as opaque boundaries unless the
component definition lives in the same file and can be analyzed safely.

## Parser

Use the official Astro compiler package for the `.astro` syntax layer. The
compiler already understands frontmatter, templates, comments, text, component
tags, custom elements, slots, and Astro expression islands.

Source ranges from the Astro compiler should be considered helpful but not
load-bearing at first. CSS diagnostics point at the CSS selector ranges, so the
first useful version only needs enough range information for internal warnings
and tests.

## Template Normalization

The adapter should normalize Astro template nodes into the existing
`RenderStory` model:

- native HTML tags become `element` nodes
- hyphenated custom elements become `element` nodes
- fragments flatten into their children
- text and comments are ignored
- `<slot />` becomes an opaque `slot render branch`
- imported components become opaque `imported or external component` branches
- dynamic component tags become opaque `dynamic component` branches

This keeps Astro behavior aligned with TSX behavior: lasertag is strict about
the component file it can see and conservative about everything outside it.

## Expressions

Astro templates can contain JSX-like expression islands:

```astro
{items.map((item) => <project-card>{item.name}</project-card>)}
{enabled ? <enabled-state /> : null}
{children}
```

The ideal implementation shares as much expression handling as possible with
the TSX analyzer. A practical path is to parse expression snippets with
TypeScript in TSX mode and reuse shared logic for ternaries, `&&`, `??`, arrays,
`.map(...)`, `null`, `false`, and opaque `children` branches.

Anything that cannot be confidently reduced to a render branch should become an
opaque node, not a dead-code claim.

## CLI And LSP Changes

The CLI and LSP can keep the narrow lasertag convention while supporting more
source extensions:

- resolve `AppPanel.module.css` to `AppPanel.tsx` or `AppPanel.astro`
- prefer an exact sibling when only one exists
- report a clear ambiguity if both exist and no config chooses one
- watch `**/*.astro` in the LSP
- activate the VSCode extension for Astro documents

The public refractor library should expose a generic validation entry point that
accepts a prepared `RenderStory`, plus source-specific helpers such as
`analyzeTsxRenderStory(...)` and `analyzeAstroRenderStory(...)`.

## Non-Goals

Inline Astro `<style>` support is a separate feature. Astro scoped styles are
not CSS Modules, and they do not follow lasertag's single exported `css.class`
contract.

Cross-file expansion should also stay out of scope. Imported `.astro`, `.tsx`,
or framework components should remain opaque unless a future feature introduces
an explicit project graph with caching and invalidation.

## JSX Runtime Compatibility

The current TSX support is not narrowly React-specific. The extractor reads
TypeScript's JSX AST and cares about rendered tag structure, not React runtime
semantics. That makes ordinary TSX from React, Preact, and Solid broadly
compatible with refractor.

lasertag already ships custom-element intrinsic types for:

- `lasertag/react-jsx`
- `lasertag/preact-jsx`
- `lasertag/solid-jsx`

Preact generally follows the same JSX shape as React for lasertag's purposes.
Solid is compatible for direct TSX markup, and refractor recognizes imported
Solid control-flow components such as `<Show>` and `<For>` as possible render
branches. Other imported framework components remain conservative opaque
boundaries.
