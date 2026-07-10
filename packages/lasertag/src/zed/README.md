# Lasertag for Zed

This extension starts the existing `lasertag-lsp` language server in Zed. The
language analysis, diagnostics, completions, and code actions all live in the
TypeScript Lasertag package; the Rust code here is only the small Zed adapter
required to register and launch that server.

## Configuration

By default the extension looks for `lasertag-lsp` on `PATH`. If it is not found,
Zed installs the matching `lasertag` npm package version into the extension work
directory and launches its bundled LSP entrypoint.

You can override the server binary in Zed settings:

```json
{
	"lsp": {
		"lasertag": {
			"binary": {
				"path": "/absolute/path/to/lasertag-lsp",
				"arguments": [],
				"env": {
					"LASERTAG_LSP_LOG_LEVEL": "debug"
				}
			}
		}
	}
}
```

Lasertag-specific settings are nested under the server settings:

```json
{
	"lsp": {
		"lasertag": {
			"settings": {
				"lasertag": {
					"log": {
						"level": "info"
					},
					"typescript": {
						"sdk": {
							"path": "/absolute/path/to/tsc"
						}
					}
				}
			}
		}
	}
}
```

The VS Code cleanup command does not have a direct Zed command-palette
equivalent. Cleanup is still exposed through the Lasertag LSP code action.
