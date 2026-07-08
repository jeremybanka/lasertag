# Solid Support Plan

Solid support should build on the existing TSX render-story extractor. Solid
uses TSX, and the TypeScript AST for ordinary markup is already the shape
refractor understands.

The future work is not:

```text
Solid source -> new reachability model
```

It is:

```text
Solid TSX source -> richer RenderStory
```

CSS selector analysis and reachability should stay unchanged.

## Current Support

Ordinary Solid TSX is broadly compatible today:

- intrinsic HTML tags become render-story elements
- hyphenated custom elements become render-story elements
- fragments flatten into their children
- ternaries, `&&`, `??`, arrays, simple `.map(...)`, `null`, `false`, and
  `undefined` are handled by the generic TSX analyzer
- local same-file components are expanded
- imported components remain opaque boundaries

lasertag also ships `lasertag/solid-jsx`, which adds type support for
hyphenated custom elements in Solid JSX.

Solid uses `class={css.class}` rather than React's `className={css.class}`, but
refractor's reachability check is concerned with tag structure rather than prop
names. The framework-specific class attribute is therefore not a blocker for
dead-selector detection.

## Where Precision Is Missing

Solid's control-flow primitives are JSX components, not syntax. To the generic
TSX analyzer, these look like ordinary imported components:

```tsx
<Show when={enabled}>
	<enabled-state />
</Show>

<For each={items}>
	{(item) => <item-row>{item.name}</item-row>}
</For>
```

Today that is safe but imprecise. The analyzer should treat those branches as
opaque rather than falsely dead, but it cannot yet see that `<enabled-state>` or
`<item-row>` are reachable.

The improvement is a Solid-aware lowering pass for known control-flow
components.

## Import-Aware Lowering

Solid-specific handling should be import-aware. We should only lower a JSX tag
as a Solid primitive when it resolves to a binding imported from the expected
Solid package.

Examples:

```tsx
import { Show, For } from "solid-js"
import { Show as When } from "solid-js"
```

This avoids accidentally giving special meaning to a user-defined `<Show>` or
`<For>` component.

The component index should track imported bindings enough to answer:

- does this JSX tag refer to `Show` from `solid-js`?
- does this alias refer to `For`, `Index`, `Switch`, or `Match`?
- does this tag refer to `Dynamic` from `solid-js/web`?

## Control-Flow Components

### `Show`

`<Show>` represents an optional branch plus an optional fallback branch.

Useful lowering:

- children are reachable when `when` is truthy
- `fallback={...}` is reachable when `when` is falsy
- render-function children can be analyzed by parsing the returned JSX

If children or fallback cannot be reduced confidently, insert an opaque branch.

### `For`

`<For>` represents a repeated branch plus an optional empty-state branch.

Useful lowering:

- render-function children are reachable repeated content
- `fallback={...}` is reachable when the collection is empty
- non-function children should be treated conservatively

The story model does not need to represent cardinality. If a repeated branch can
exist once, its selector paths are reachable.

### `Index`

`<Index>` is similar to `<For>`, but its callback receives an accessor for the
item. For render-story purposes, it can use the same lowering shape:

- callback return value is the repeated branch
- fallback is an optional branch

### `Switch` And `Match`

`<Switch>` is a union of its reachable `<Match>` children plus an optional
fallback.

Useful lowering:

- each imported Solid `<Match>` child contributes its children as possible
  branches
- `fallback={...}` contributes another possible branch
- non-`Match` children should become opaque or be analyzed conservatively

`<Match>` outside a recognized `<Switch>` should remain opaque unless there is a
clear reason to lower it independently.

### `Dynamic`

`<Dynamic>` from `solid-js/web` is usually a dynamic component boundary.

Useful lowering:

- `component="my-element"` can become an element node with that tag name
- `component={SomeLocalComponent}` can expand the local component if it is in the
  same file
- unknown dynamic values should remain opaque

### Portal-Like Components

Portal-style rendering should be handled carefully because it changes DOM
placement. If content is rendered outside the component's local subtree, it
should not make descendant selectors under the local root reachable.

The first version should treat portals as opaque or out-of-tree, not as normal
children.

## Implementation Shape

The TSX analyzer should gain a small framework-lowering layer:

1. collect import bindings while building the component index
2. keep the generic JSX element path for intrinsic tags and local components
3. before treating an imported component as opaque, ask registered framework
   lowerers whether they can produce `StoryChild[]`
4. ship a Solid lowerer for `Show`, `For`, `Index`, `Switch`, `Match`, and
   selected `solid-js/web` primitives

The lowerer should use existing expression analysis for JSX expressions,
callback bodies, fallback props, arrays, and conditional branches. Any uncertain
case should return an opaque node.

## Tests

Solid support should start with golden fixtures:

- `Show` with children only
- `Show` with fallback
- `Show` with render-function children
- `For` with row callback
- `For` with fallback
- `Index` with row callback
- `Switch` with multiple `Match` branches and fallback
- aliased imports such as `Show as When`
- user-defined `Show` that must not be treated as Solid control flow
- `Dynamic` with a literal custom-element tag
- unknown `Dynamic` value that remains opaque

Each fixture should assert the extracted `RenderStory`, then CSS reachability
tests should confirm that selectors under lowered branches are considered
reachable.

## Non-Goals

This does not require understanding Solid's runtime reactivity. lasertag only
needs the possible DOM shapes, not when signals update.

Cross-file expansion should stay out of scope. Imported Solid components from
other files should remain opaque unless a later project-graph feature provides
explicit, cached expansion.

The ESLint convention rules can stay mostly framework-neutral. They may need
small affordances for Solid syntax, but the main precision gain belongs in
refractor's render-story extractor.
