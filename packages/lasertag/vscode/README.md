# Lasertag VSCode Extension

This extension runs the bundled `lasertag-lsp` server and reports dead CSS module
selectors in `.module.css` files.

It syncs open CSS module and TSX documents to the server, and watches
`**/*.module.css` plus `**/*.tsx` in the workspace.

Set `lasertag.lsp.path` to use a workspace-provided `lasertag-lsp` executable
instead of the bundled server. Relative paths resolve from the workspace root.

Set `lasertag.typescript.sdk.path` to use a workspace-provided TypeScript 7
native executable for TSX parsing. Relative paths resolve from the workspace
root. The same value is forwarded to the server as `LASERTAG_TYPESCRIPT_SDK_PATH`.
