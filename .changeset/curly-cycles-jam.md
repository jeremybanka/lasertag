---
"lasertag": minor
---

Reshape the CLI around explicit `check`, `fix`, and `vsix` commands.
`lasertag check` now validates CSS modules, `lasertag fix` keeps the existing
cleanup stub, and `lasertag vsix` builds a current-platform VS Code extension
from the installed SDK before installing it into the requested editor command.
