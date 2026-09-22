# lasertag

lasertag is a small, structural CSS Modules convention for JSX components: each exported component owns one sibling `.module.css` file, and that stylesheet contains one root class named `.class`.

## Component Modules

Name the component and its stylesheet together:

```text
CheckboxField.tsx
CheckboxField.module.css
```

Import CSS modules as `css`, then apply only the root class with your JSX runtime's class attribute, such as `className={css.class}` or `class={css.class}`. Exported component names must contain multiple words so the matching kebab-case root is a hyphenated custom element:

```tsx
import css from "./AppHeaderBar.module.css"

export const AppHeaderBar = () => (
	<app-header-bar className={css.class}>
		<left-side>
			<strong>SignalDesk</strong>
			<AppNav />
		</left-side>
		<UserProfileButton />
	</app-header-bar>
)
```

The matching stylesheet should have a single top-level member:

```css
app-header-bar.class {
	> left-side {}
}
```

A component module should export the component it is named for, and should avoid exporting unrelated values. Component files should import only their own sibling CSS module, and should import it as `css`.

Exported components do not get root-tag exceptions. Their root must be the
component-named custom element so ownership stays visible in JSX, the DOM, and
CSS. Put semantic and interactive elements inside that root:

```tsx
import css from "./CheckboxField.module.css"

export const CheckboxField = (inputProps) => (
	<checkbox-field className={css.class}>
		<label>
			<input {...inputProps} type="checkbox" />
			<span>Enabled</span>
		</label>
	</checkbox-field>
)
```

```css
checkbox-field.class {
	> label {
		> input {}
		> span {}
	}
}
```

Local, non-exported components may use a native or semantic root when that is
the clearest structure. The `render-tag-with-own-name` ESLint rule checks
directly exported named declarations by default. Set
`checkAllComponentFunctions: true` to apply the component-named root convention
to every PascalCase component function, including local components.

## Hono JSX

Hono components use the same sibling CSS Modules and named custom roots as
React, Preact, and Solid components. Add these type-only entrypoints to a
declaration file included by your TypeScript project:

```ts
import "lasertag/css-modules"
import "lasertag/hono-jsx"
```

Configure the JSX runtime:

```json
{
	"compilerOptions": {
		"jsx": "react-jsx",
		"jsxImportSource": "hono/jsx"
	}
}
```

`react-jsx` names TypeScript's automatic JSX transform; `hono/jsx` supplies the
runtime. Use Hono's own `PropsWithChildren`, `FC`, and JSX types when needed.
Lasertag's Hono entrypoint gives hyphenated tags Hono HTML attributes without
adding React types or a global JSX namespace.

```tsx
import css from "./ProjectCard.module.css"

export async function ProjectCard({
	loadName,
}: {
	loadName: () => Promise<string>
}) {
	const name = await loadName()
	return (
		<project-card class={css.class}>
			<h2>{name}</h2>
			<button
				type="button"
				hx-get="/project"
				hx-target="closest project-card"
				hx-swap="outerHTML"
			>
				Refresh
			</button>
		</project-card>
	)
}
```

```css
project-card.class {
	display: grid;
	gap: 1rem;

	> h2 {
		margin: 0;
	}

	> button {
		justify-self: start;
	}
}
```

Async component returns, ordinary JSX conditionals, and array maps are analyzed
without executing the component or its data loaders. Hono `Fragment` and
`StrictMode` preserve their children. `Suspense` (including its
`hono/jsx/streaming` export) contributes both content and fallback branches;
`ErrorBoundary` also contributes its `fallback` and inline `fallbackRender`
branches. Aliases, namespace imports, and the default `hono/jsx` namespace are
recognized. Components imported from `hono/jsx/dom` use the same analysis.
Imported Hono `memo` and `forwardRef` wrappers preserve the render function's
structure; arbitrary factories remain unknown.
Unknown children, render callbacks, and imported component implementations keep
the ordinary ownership boundaries. Streaming transport markup is not an
authoring target for component selectors.

### Stylesheet delivery and HTML fragments

Your build tool must compile CSS Modules into class mappings and browser CSS.
Lasertag supplies conventions, types, and analysis; importing
`lasertag/css-modules` does not add a CSS compiler to Wrangler. Use a CSS
Modules-capable build pipeline and serve its emitted CSS with the application.
Include the stylesheet in the document head, including styles for components
that may arrive later through HTMX. The server's class mappings and the served
CSS must come from the same build.

Keep the document shell (`html`, `head`, and `body`) in a route or renderer
callback, or a local helper. Exported UI components still own their named custom
roots. A fragment route can return `c.html(<ProjectCard ... />)` directly;
replacing the complete `<project-card>` preserves its class and ownership root.
When adding fragments inside a container, give each exported fragment its own
root and stylesheet. Keep selectors scoped to the DOM that component renders.

Lasertag does not infer future DOM from `hx-get`, `hx-target`, or `hx-swap`, and
does not follow routes to assemble a page-wide render story. If external code
inserts DOM that truly belongs to a component's styling contract, use a narrowly
explained `@lasertag-expect-error` for a selector the static story cannot see.
The [Hono example](../examples/hono) shows a full document and a replacement
fragment sharing one CSS Module component. Its host must supply HTMX and serve
the compiled stylesheet.

Hono's `css` tagged templates and `<Style />` are a separate styling system;
Refractor analyzes sibling `.module.css` files.

## Nest the Rendered Structure

The stylesheet should read like the component renders. Prefer tag selectors and direct-child selectors so the CSS mirrors the JSX tree:

```tsx
export const AppHeaderBar = () => (
	<app-header-bar className={css.class}>
		<left-side>
			<app-logo>
				<AppLogoSvg />
			</app-logo>
			<AppNav />
		</left-side>
		<right-side>
			<UserProfileButton />
		</right-side>
	</app-header-bar>
)
```

```css
app-header-bar.class {
	> left-side {
		> app-logo {
			> svg {}
		}
	}

	> right-side {}
}
```

Nested selectors must stay within DOM owned by the component file. Imported
components, render props, and `{children}` introduce ownership boundaries. A
selector that enters their output is reported as
`selector-crosses-ownership-boundary`, even when it also matches locally owned
DOM:

```tsx
export const AppPanel = ({ children }) => (
	<app-panel className={css.class}>
		<header>
			<h1>Account</h1>
		</header>
		{children}
	</app-panel>
)
```

```css
app-panel.class {
	/* Can style every element supplied through children. */
	* {}
}
```

Broad descendant selectors are valid in dead-end components whose matching
subtree is entirely defined in the same file. Ownership analysis is
path-sensitive, so an imported component in one branch does not prevent styling
a separate, fully owned branch. Direct-child selectors can also cross a boundary
when they style the root rendered by a foreign component or `{children}`.
When Lasertag resolves a foreign component root and a selector matches it,
`selector-matches-foreign-component-root` reports the verified collision. When
the root remains opaque, `opaque-component-root-may-collide` reports that the
component may render a matching root. Related selectors that share the same
first uncertain root are grouped into one diagnostic. Local reachability does
not change either result: the same selector may match owned and foreign DOM at
runtime.

Foreign roots are resolved from evidence in the TypeScript module graph, not
from the component's name. When module resolution reaches an implementation
whose supported return branches expose outer JSX nodes, Lasertag records those
nodes as concrete foreign roots. Relative imports, package imports, re-exports,
and namespace imports all use the same rule. If resolution fails, lands only on
a declaration file, or reaches an implementation shape Refractor cannot prove,
the root remains opaque. For example, a component named `Dialog` that actually
returns `<section>` is treated as a foreign `<section>` root; Lasertag never
infers `<dialog>` from the export name.

### Adopt a Headless Component's Render Story

A headless component can deliberately make its rendered structure part of one
consumer component's styling contract. Put an `@lasertag-adopt-subtree`
opening-tag directive on the imported component instance:

```tsx
import { MosaicLexicalTextEditor } from "@mosaic/lexical"

export function LexicalMarkdownEditor(props: EditorProps) {
	return (
		<lexical-markdown-editor className={css.class}>
			<MosaicLexicalTextEditor
				/* @lasertag-adopt-subtree */
				{...props}
			/>
		</lexical-markdown-editor>
	)
}
```

The block comment has no runtime output. It can appear anywhere among the
opening tag's attributes and applies only to that component instance; another
instance of the same component remains a foreign ownership boundary unless its
opening tag has its own directive. Lasertag reports `invalid-adoption-target`
when the directive is on anything other than an imported component instance.
The directive must be the only content in its block comment, may appear only
once, and must be inside the opening tag. Violations report
`invalid-adoption-directive`. The earlier sibling-comment syntax,
`{/* @lasertag-own-subtree */}`, also reports that diagnostic with migration
guidance. These warnings point to the source comment in editor diagnostics.

Adoption retains the component's provable render story instead of retaining
only its foreign outer root. The consumer's CSS Module can therefore describe
the shipped semantic structure:

```css
lexical-markdown-editor.class {
	> mosaic-lexical-text-editor {
		> lexical-editor {
			> [contenteditable="true"] {}
			> collaborator-overlays > collaborator-caret {}
		}
	}
}
```

This is validation, not a suppression. Selectors that do not occur in the
adopted story still report `dead-selector`. Imported components nested within
the adopted implementation remain foreign boundaries, as do `children`,
render props, slots, and other opaque branches. Portals remain outside the
descendant story. Intrinsic-root assertions such as `svg.SomeIcon` remain
shallow foreign roots even when they occur inside an adopted story.

Lasertag adopts only implementation evidence it can resolve. A package can
expose TSX directly through its TypeScript module graph. A declaration-first
package can instead ship declaration source maps whose `sources` entries point
to the original `.tsx` or `.jsx` files; either those files or matching `sourcesContent`
must be present. Lasertag considers only source-map-listed files and requires a
single matching component implementation, so it does not guess from emitted
filenames or package layout. If no sufficiently analyzable implementation is
available, `adoption-source-unavailable` is reported and the component remains
foreign.

For external components with an intentionally stable intrinsic root, a JSX
member expression can assert that root at the call site. Name the namespace
after a standard HTML or SVG tag:

```tsx
const svg = {
	MagnifyingGlass: MagnifyingGlassIcon,
}

export const CommandSearch = () => (
	<command-search className={css.class}>
		<svg.MagnifyingGlass />
		<input />
	</command-search>
)
```

```css
command-search.class {
	/* Allowed: this ends at the asserted external root. */
	> svg {}

	/* Warns: the component owns everything below its root. */
	> svg > path {}

	/* Allowed: the asserted root does not make owned siblings uncertain. */
	> input {}
}
```

This is an unchecked assertion: Refractor does not inspect the namespace value
or resolve the member implementation. Standard intrinsic namespaces include
HTML and SVG names such as `span`, `article`, `div`, and `svg`. Arbitrary names
and custom-element spellings remain opaque component boundaries.

## Tags Tell the Story

Use a custom tag for the root of every exported component, named after that component in kebab case. `AppHeaderBar` should render `<app-header-bar className={css.class}>`; `ProjectList` should render `<project-list className={css.class}>`.

Use official semantic HTML when it fits inside that wrapper: `nav`, `ul`, `ol`, `li`, `article`, `blockquote`, `data`, `time`, `output`, `meter`, and `progress` all carry useful meaning.

Use `header`, `main`, and `footer` only as siblings under the same parent. If any of those tags appears under a parent, that parent should contain at least two of those tags and no unrelated element children. `header`/`main`, `main`/`footer`, and `header`/`footer` are all okay; they gain meaning from their relationship under one parent.

For interactions, prefer the browser's form controls: `input`, `textarea`, `button`, `label`, `select`, `option`, `fieldset`, and `legend`.

When no built-in tag describes the local structure clearly, create a hyphenated custom element such as `left-side`, `project-summary`, or `brand-lockup`. Custom elements make the DOM and CSS easier to map back to the component.

Never use `<div>`. Use a semantic HTML element, form control, or highly local custom element instead.

Avoid single-child wrapper tags unless the wrapper distinguishes a meaningful thing, such as a form control, image, SVG, layout boundary, or independently styled repeated item.

## Expected Reachability Errors

When runtime behavior adds an element that Lasertag cannot see in the component's render story, suppress the diagnostic on the immediately following line with an explained `@lasertag-expect-error` comment:

```css
app-canvas.class {
	/* @lasertag-expect-error: gets appended via useEffect */
	> canvas {
		display: block;
	}
}
```

The explanation after the colon must contain at least three characters. Lasertag reports the directive when the following line has no reachability or ownership-boundary diagnostic, so `lasertag fix` and the editor cleanup action can remove stale comments.

To suppress one diagnostic type across a larger region, pair diagnostic-scoped `@lasertag-disable` and `@lasertag-enable` comments:

```css
app-canvas.class {
	/* @lasertag-disable [dead-selector] inserted by the canvas runtime */
	> canvas {}
	> canvas-overlay {}
	/* @lasertag-enable [dead-selector] */

	> footer {}
}
```

Put the diagnostic code in brackets. A disable also requires an explanation of at least three characters after the closing bracket; an enable does not accept an explanation. The supported reachability diagnostic codes are `dead-selector`, `impossible-local-class`, `opaque-component-root-may-collide`, `selector-crosses-ownership-boundary`, and `selector-matches-foreign-component-root`. Regions for different codes may overlap, and a disable without a matching enable remains active through the end of the file. Lasertag reports `disable-explanation-too-short` when the explanation is missing or too short, `unused-disable` when a disable suppresses no matching diagnostics, and `unused-enable` when an enable appears outside an active region for the same code.

### Conservative JSX cleanup

Lasertag makes no guarantees for `innerHTML` or `dangerouslySetInnerHTML`. Injected HTML is outside static analysis; CLI fixes and editor cleanup may remove selectors used only by that HTML.

Lasertag preserves CSS when a render branch is unknown. An arbitrary factory such as `wrap(() => <span />)` may insert elements around its callback, so Lasertag does not treat the callback as the factory's complete output. Imported React, Preact compatibility, and Hono `memo` and `forwardRef` wrappers remain supported. Custom factories can therefore produce fewer dead-selector diagnostics and more ownership-boundary warnings; cleanup leaves those uncertain selectors intact.

Framework component recognition respects local bindings: a parameter named `Fragment` or `Show` does not inherit the behavior of a shadowed framework import. Transparent framework wrappers also account for explicit `children` props, including when the JSX body contains only comments or formatting whitespace. Spread render props remain conservative because they can supply children or fallbacks that are not visible at the call site.

## Type Support

The `lasertag/css-modules` type export constrains CSS Modules to a single exported `class` member:

```ts
declare module "*.module.css" {
	const css: { class: string }
	export default css
}
```

lasertag ships JSX intrinsic element types for React, Preact, Solid, and Hono. Each allows arbitrary hyphenated custom elements in JSX:

- `lasertag/react-jsx`
- `lasertag/preact-jsx`
- `lasertag/solid-jsx`
- `lasertag/hono-jsx`
