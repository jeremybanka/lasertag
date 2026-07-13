---
"lasertag": minor
---

Add Astro render story extraction and recognize same-named `.astro` files as CSS
Module neighbors in the CLI, LSP, and VS Code extension. Report an error when
both `.astro` and `.tsx` neighbors exist. Add LSP analysis summaries and debug
traces for render-source resolution, normalized render stories, and selector
reachability, and surface render-story analysis failures as editor errors.
Preserve explicit children passed through Astro layout components and scope
PascalCase component uncertainty beneath their Lasertag-conventional custom
roots.
