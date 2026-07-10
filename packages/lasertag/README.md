# Lasertag 👾

zero-runtime CSS structure for JSX components with CSS Modules.

lasertag is a small convention: each exported component owns one sibling
`.module.css` file, that stylesheet exports one root `class`, and the rendered
root tag names the component in kebab case.

```tsx
import css from "./AppHeaderBar.module.css"

export const AppHeaderBar = () => (
	<app-header-bar className={css.class}>
		<strong>SignalDesk</strong>
	</app-header-bar>
)
```

```css
app-header-bar.class {
	display: flex;
	align-items: center;
}
```

## Install

```sh
pnpm add -D lasertag
```

Add the types your project needs:

```ts
import "lasertag/css-modules"
import "lasertag/react-jsx"
```

Use `lasertag/preact-jsx` or `lasertag/solid-jsx` instead for Preact or Solid.

Check component-owned CSS Modules for unreachable selectors in parallel:

```sh
pnpm lasertag check
```

Remove unreachable selectors in parallel while reporting progress:

```sh
pnpm lasertag fix
```

Both commands accept one quoted glob or a comma-separated set of globs:

```sh
pnpm lasertag fix "src/**/*.module.css,examples/**/*.module.css"
```

Install the VSCode extension from the same npm package:

```sh
pnpm lasertag vsix
```

Pass an editor command when you want to target another VSCode-compatible binary:

```sh
pnpm lasertag vsix --target code-insiders
```

Build the VSIX without installing it:

```sh
pnpm lasertag vsix --build-only
```

## Includes

- CSS Module typing for a single exported `class`
- JSX intrinsic types for hyphenated custom elements
- an optional ESLint plugin at `lasertag/eslint-plugin`
- a small global CSS starter at `lasertag/templates/globals.css`
- short guides in `lasertag/docs`
