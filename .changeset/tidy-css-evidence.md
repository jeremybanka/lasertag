---
"lasertag": patch
---

Resolve css.class to its authored stylesheet in CLI check and fix and the editor's CSS ownership view. Install css-modules-content-mapper and register it for .module.css in the top-level tsconfig.json contentMappers array; Astro files also need @astrojs/ts-content-mapper registered for .astro. Lasertag uses these registrations automatically in trusted projects, with no additional feature settings. Shared TypeScript analysis reuses project state across files and edits, and mapper failures fall back to ordinary analysis. Existing CSS diagnostics, completions, cleanup rules, and the .class-only contract are preserved. See docs/tooling-guide.md for setup and verification.
