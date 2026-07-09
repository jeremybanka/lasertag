---
"lasertag": patch
---

Publish sourcemaps for bundled runtime code and declaration sourcemaps for the
typed library entrypoints. The package now emits JavaScript maps for CLI, LSP,
ESLint plugin, and refractor code while limiting generated declarations to the
importable APIs that benefit from them.
