---
"lasertag": patch
---

Add a configurable TypeScript 7 native executable path for CLI validation and
the VS Code extension. The extension exposes `lasertag.typescript.sdk.path` and
forwards the resolved value to the language server as
`LASERTAG_TYPESCRIPT_SDK_PATH`.
