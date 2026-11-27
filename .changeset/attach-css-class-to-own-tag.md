---
"lasertag": patch
---

Add the opt-in `attach-css-class-to-own-tag` ESLint rule, which requires an exported component's own-name root tag to carry `css.class`. Fails: `export function ToolBar() { return <tool-bar /> }`. Blessed: `import css from "./ToolBar.module.css"`, then `export function ToolBar() { return <tool-bar class={css.class} /> }`; `className={css.class}` passes too.
