---
"lasertag": patch
---

Bundle the TypeScript 7 JavaScript SDK into the VS Code language server bundle
and package only the current platform's native TypeScript executable on disk.
Empty `lasertag.typescript.sdk.path` settings now use that bundled native
executable by default.
