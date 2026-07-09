---
"lasertag": minor
---

Reshape the CLI around explicit `check`, `fix`, and `vsix` commands.
`lasertag check` now validates CSS modules, `lasertag fix` keeps the existing
cleanup stub, and `lasertag vsix` builds a current-platform VS Code extension
from the installed SDK before installing it into the requested editor command.

The VSIX builder now bundles the TypeScript 7 JavaScript SDK into the language
server bundle while keeping only the platform-native TypeScript executable on
disk. The `lasertag.typescript.sdk.path` setting remains available as an
override, and empty settings use the bundled native executable.
