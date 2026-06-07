# lasertag

zero-runtime structural css for jsx with css modules

- Give each exported React component its own sibling CSS module named after the component, for example `Checkbox.tsx` and `Checkbox.module.css`.
- Each CSS module should expose one member, `.class`, and components should import it as `css` and apply it only as `className={css.class}`.
- Exported React components should use a hyphenated custom element matching the component name as their root wrapper, for example `AppHeaderBar` renders `<app-header-bar className={css.class}>`. Only make exceptions for interactive or form elements where a native tag such as `button`, `label`, `input`, `select`, or `form` is the meaningful wrapper.
- Model the rendered DOM structure in CSS with nesting; prefer direct-child selectors with `>` and tag-name selectors under the root `.class`.
- Use form controls when they fit.
- Use semantic HTML and descriptive custom tags.
- Never use `<div>`. Use a semantic HTML element, form control, or descriptive custom tag instead.
- Use `<header>`, `<main>`, and `<footer>` only as siblings under the same parent; `<header>`/`main`, `<main>`/`<footer>`, and `<header>`/`<footer>` are all valid pairings, but these tags should not appear alone or mixed with unrelated sibling elements.
- Avoid extra single-child wrappers unless they distinguish an important element such as a form control, media element, or SVG.
- Prefer a small `globals.css`, imported by the main entrypoint, for an uncontroversial reset, font imports, and semantic color variables. Keep component styling in CSS Modules.
- Keep detailed examples and edge-case guidance in `./docs/lasertag-guide.md` and `./docs/globals-guide.md`.
