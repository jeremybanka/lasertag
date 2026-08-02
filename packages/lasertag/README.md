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

Install the VS Code extension from the same npm package:

```sh
pnpm lasertag vsix
```

Pass an editor command when you want to target another VS Code-compatible binary:

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
- the Refractor analysis library at `lasertag/refractor`
- the `lasertag` CLI and standalone `lasertag-lsp` language server
- a bundled VS Code extension with live diagnostics, completions, and cleanup actions
- a small global CSS starter at `lasertag/templates/globals.css`
- [authoring](docs/lasertag-guide.md) and [tooling](docs/tooling-guide.md)
  guides in `lasertag/docs`

## License

Lasertag is free and open-source software under the
[Mozilla Public License 2.0](LICENSE). MPL 2.0 is permissive about using
Lasertag and combining it with other code while preserving improvements to
MPL-covered files. It is a file-level copyleft license, not a whole-project
copyleft license.

In practical terms, you may:

- use Lasertag for any purpose, including in commercial and proprietary
  applications;
- modify and use it privately without sharing those changes; and
- combine it with code under other licenses. Separate files that contain no
  MPL-covered code can remain under terms of your choice.

If you distribute modified MPL-covered files, make the source for those files
available under MPL 2.0 and preserve the license notices. Mozilla's
[official MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains
the intent and common use cases. This summary is not a substitute for the
license itself.
