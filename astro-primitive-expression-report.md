# Opaque external sibling causes ownership-warning cascade across locally authored branches

## Summary

With Lasertag 0.6.2, an imported component with an unknown root can cause every
matching direct-child selector beneath the same parent to receive
`selector-crosses-ownership-boundary`. This includes selectors whose visible
match is a branch authored entirely in the local component.

The behavior is conservatively correct: an opaque external component could
theoretically render the same root tag as a local sibling. In practice, however,
one opaque sibling can create a large cascade of warnings that obscures the
selector that genuinely styles foreign DOM.

## Environment

- Lasertag: 0.6.2
- Previous version: 0.5.4
- Render source: TSX with Preact
- Stylesheet: nested CSS Module

In the motivating `CodeBlock` component, Lasertag 0.6.2 reports 12 ownership
warnings. Lasertag 0.5.4 reported no diagnostics for the same file.

## Minimal reproduction

```tsx
import { External } from "external-package"

import css from "./Example.module.css"

export function Example() {
	return (
		<example-root class={css.class}>
			<local-toolbar>
				<button type="button">
					<svg />
				</button>
			</local-toolbar>
			<External />
		</example-root>
	)
}
```

```css
example-root.class {
	> local-toolbar {
		> button {
			> svg {}
			&:hover::before {}
		}
	}
}
```

Run:

```sh
lasertag check
```

## Actual result

Lasertag reports four `selector-crosses-ownership-boundary` warnings:

1. `example-root.class > local-toolbar`
2. `example-root.class > local-toolbar > button`
3. `example-root.class > local-toolbar > button > svg`
4. `example-root.class > local-toolbar > button:hover::before`

The apparent match for every selector is locally authored. The warnings arise
because the opaque `<External />` sibling could theoretically render a
`local-toolbar` root and therefore satisfy the same selector path.

## Comparison with the 0.6.2 intrinsic-root assertion

When the external component has a stable intrinsic root, the new 0.6.2
namespace assertion removes the warning cascade:

```tsx
import { External } from "external-package"

import css from "./Example.module.css"

const pre = { External }

export function Example() {
	return (
		<example-root class={css.class}>
			<local-toolbar>
				<button type="button">
					<svg />
				</button>
			</local-toolbar>
			<pre.External />
		</example-root>
	)
}
```

The local-toolbar selectors no longer warn. A selector ending at the asserted
root is also accepted, while a selector descending into foreign DOM still warns:

```css
example-root.class {
	> local-toolbar {
		> button {
			> svg {}
			&:hover::before {}
		}
	}

	/* Accepted: ends at the asserted external root. */
	> pre {}

	/* Warns: styles DOM owned by the external component. */
	> pre > code {}
}
```

## Real-world result

The motivating component renders an imported `SyntaxHighlighter` next to local
`back-fill` and `file-name` branches:

```tsx
;<code-block class={css.class}>
	<back-fill />
	<file-name>
		<span>{displayLabel}</span>
		<button type="button">
			<svg />
		</button>
	</file-name>
	<SyntaxHighlighter>{code}</SyntaxHighlighter>
</code-block>
```

With `<SyntaxHighlighter>`, the stylesheet produces 12 warnings. Eleven are on
the locally authored `back-fill` and `file-name` branches. The twelfth is a
broad `code-block.class span` selector that genuinely can style token spans
owned by the syntax highlighter.

Changing only the component expression to an asserted `pre` root reduces the
same stylesheet from 12 warnings to the one genuine cross-boundary warning:

```tsx
const pre = { SyntaxHighlighter }

// ...

<pre.SyntaxHighlighter>{code}</pre.SyntaxHighlighter>
```

## Question for evaluation

Is the warning fan-out from an unasserted opaque sibling the intended diagnostic
experience?

If the conservative behavior should remain, possible ergonomic improvements
might include:

- grouping or deduplicating diagnostics caused by the same opaque boundary;
- attaching the opaque component and reason as diagnostic evidence;
- suggesting an intrinsic-root namespace assertion when it would make the
  selector addressable; or
- emitting one root-cause diagnostic at the opaque component instead of a
  warning at every refinement beneath the locally authored selector path.

The intrinsic-root assertion works well once applied. The concern is that,
without a hint connecting the warning cascade to the opaque sibling, the local
selectors look independently invalid and the one actionable ownership warning
is easy to miss.

## References

- Lasertag 0.6.2 changelog:
  https://github.com/jeremybanka/lasertag/blob/HEAD/packages/lasertag/CHANGELOG.md#062
- Lasertag guide:
  https://github.com/jeremybanka/lasertag/blob/HEAD/packages/lasertag/docs/lasertag-guide.md
- atom.io dependency update:
  https://github.com/jeremybanka/atom.io/pull/447

# Astro primitive interpolation is treated as foreign DOM and produces incorrect ownership diagnostics

## Summary

Lasertag 0.6.4 treats an Astro interpolation with no child AST nodes as an
unknown foreign render branch, including an interpolation whose value is
statically a string literal.

This makes descendant selectors appear capable of crossing an ownership
boundary through text content. It produces false
`selector-crosses-ownership-boundary` warnings for reachable locally authored
elements and prevents genuinely dead selectors from receiving `dead-selector`.

## Environment

- Lasertag: 0.6.4
- Render source: Astro
- Stylesheet: nested CSS Module

## Minimal reproduction

`Literal.astro`:

```astro
---
import css from "./Literal.module.css"
---

<literal-example class={css.class}>
	<section>
		<h2>{"Title"}</h2>
	</section>
</literal-example>
```

`Literal.module.css`:

```css
literal-example.class {
	> section > h2 {}
	> section h2 {}
	> section h3 {}
}
```

Run:

```sh
lasertag check
```

## Actual result

Lasertag reports:

```text
selector-crosses-ownership-boundary: literal-example.class > section h2
selector-crosses-ownership-boundary: literal-example.class > section h3
```

The direct-child selector `> section > h2` does not warn, but the equivalent
descendant selector `> section h2` does.

## Expected result

- `literal-example.class > section > h2` is reachable and should not warn.
- `literal-example.class > section h2` is reachable and should not warn.
- `literal-example.class > section h3` is unreachable and should report
  `dead-selector`.

Replacing `{"Title"}` with static text produces exactly that result: both `h2`
selectors pass and the `h3` selector receives `dead-selector`.

## Likely cause

The Astro analyzer currently lowers an expression with no child element nodes
to:

```text
opaque, ownership: foreign, reason: unknown Astro expression render branch
```

That is appropriate for an expression whose value could be a component, an
element, or an arbitrary renderable collection. It is not appropriate for an
expression that is statically known to be a primitive.

During descendant ownership analysis, the opaque child beneath `<h2>` is then
treated as potentially containing any descendant tag. As a result:

- the local `h2` selector is said to cross into foreign DOM through its own text
  content; and
- the nonexistent `h3` is considered potentially foreign instead of dead.

The issue does not require TypeScript inference to reproduce: a string literal
inside the Astro interpolation is sufficient.

## Real-world impact

This occurs in `apps/atom.io.fyi/src/pages/docs/concepts.astro`, where the render
source includes primitive interpolations such as:

```astro
<h2>{frontmatter.title.toLowerCase()}</h2>
<span>{frontmatter.summary}</span>
<li>{packageName}</li>
<a>{conceptLabelBySlug.get(slug) ?? slug}</a>
```

Their types are strings in the page's frontmatter declarations and collection
types.

Lasertag currently reports eleven ownership warnings in the corresponding CSS
Module. Replacing only those four interpolations with static text in memory
leaves:

- one legitimate ownership warning for the broad
  `concepts-glossary.class > concept-module h2` selector, which can reach an
  `<h2>` rendered by the foreign Markdown `<Content />` component; and
- two `dead-selector` diagnostics for stale `code` selectors beneath the local
  header paragraph.

Therefore, ten of the eleven current ownership warnings are incorrectly caused
by primitive Astro interpolations. Eight should disappear, and two should be
classified as dead selectors instead.

Affected selector shapes include:

```text
concepts-glossary.class > concept-module > header p
concepts-glossary.class > concept-module > header p code
concepts-glossary.class > concept-module > header p span
concepts-glossary.class > concept-module > main > concept-metadata h3
concepts-glossary.class > concept-module > main > concept-metadata ul
concepts-glossary.class > concept-module > main > concept-metadata li
concepts-glossary.class > concept-module > main > concept-metadata a
concepts-glossary.class > concept-module > main > concept-metadata a:hover
```

## Question for evaluation

Could the Astro analyzer recognize expressions that are syntactically known to
be primitives before introducing an opaque foreign render branch?

A minimal first step could cover literal strings, numbers, booleans, `null`, and
`undefined`. Type-aware handling of frontmatter identifiers and expressions
could follow separately.

If unknown primitive-looking expressions must remain conservative, another
option would be to distinguish opaque text/value content from opaque DOM
content. Descendant selector analysis could then avoid traversing primitive
content as though it were a foreign element subtree.

## References

- Lasertag 0.6.4 changelog:
  https://github.com/jeremybanka/lasertag/blob/HEAD/packages/lasertag/CHANGELOG.md#064
- Lasertag guide:
  https://github.com/jeremybanka/lasertag/blob/HEAD/packages/lasertag/docs/lasertag-guide.md
- atom.io dependency update:
  https://github.com/jeremybanka/atom.io/pull/447
