# Lasertag VSCode Extension

This extension runs the bundled `lasertag-lsp` server and reports dead CSS module
selectors in `.module.css` files.

It syncs open CSS module and TSX documents to the server, and watches
`**/*.module.css` plus `**/*.tsx` in the workspace.

Set `lasertag.lsp.path` to use a workspace-provided `lasertag-lsp` executable
instead of the bundled server. Relative paths resolve from the workspace root.
