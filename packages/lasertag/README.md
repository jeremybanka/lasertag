# lasertag

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

## Includes

- CSS Module typing for a single exported `class`
- JSX intrinsic types for hyphenated custom elements
- an optional ESLint plugin at `lasertag/eslint-plugin`
- a small global CSS starter at `lasertag/templates/globals.css`
- short guides in `lasertag/docs`
