---
"lasertag": minor
---

Reshape the CLI around explicit `check`, `fix`, and `vsix` commands. Previously,
bare `lasertag` validated CSS modules, `--fix` selected the cleanup stub, and
`--vscode-install` installed a prebuilt VS Code extension artifact.

Now, bare `lasertag` prints help, `lasertag check` validates CSS modules,
`lasertag fix` keeps the existing cleanup stub, and `lasertag vsix` builds a
current-platform VS Code extension from the installed SDK before installing it
into the requested editor command.
