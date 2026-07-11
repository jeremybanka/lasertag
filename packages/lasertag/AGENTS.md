# lasertag

zero-runtime structural css for jsx with css modules

- Give each exported JSX component a same-named sibling CSS Module (`CheckboxField.tsx` and `CheckboxField.module.css`). It exposes only `.class`; import it as `css` and apply it to the root with `className={css.class}` or the runtime equivalent.
- Every exported component must have a name with multiple words and render its matching hyphenated custom root (`AppHeaderBar` renders `<app-header-bar>`), with no native-element exceptions. Local components may use semantic or form-control roots.
- Mirror the rendered DOM in nested CSS, preferring `>` and tag selectors under `.class`. Avoid meaningless single-child wrappers.
- Prefer semantic HTML and native form controls; otherwise use descriptive custom tags. Never use `<div>`.
- Use `<header>`, `<main>`, and `<footer>` only as a sibling group: put at least two under one parent and do not mix in unrelated element siblings.
- Keep `globals.css`, imported by the main entrypoint, small: resets, fonts, and semantic tokens. Keep component styling in CSS Modules.
- Use the ESLint plugin at `lasertag/eslint-plugin`; scope component rules to JSX files. `render-tag-with-own-name` checks directly exported named declarations by default; set `checkAllComponentFunctions: true` to include every PascalCase component function.
- Refractor (`lasertag/refractor`) compares a TSX render story with its sibling CSS Module. Use the API for custom analysis; unknown paths are not dead CSS.
- After changing a component or its CSS Module, run `pnpm lasertag check`; use `pnpm lasertag fix` only when automatic removal of diagnosed selectors is intended, then review the diff and rerun `check`.
- For live diagnostics, completions, and cleanup actions, use `lasertag-lsp` or install the VS Code extension with `pnpm lasertag vsix`. See [`docs/tooling-guide.md`](docs/tooling-guide.md) for analysis boundaries, API examples, and editor setup; run `pnpm lasertag --help` for CLI syntax.
