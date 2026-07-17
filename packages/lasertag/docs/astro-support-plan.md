# Astro Support Plan

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
