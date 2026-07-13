# Lasertag for VS Code

Render-aware diagnostics and CSS completions for component-owned CSS Modules.
Lasertag compares each `Component.module.css` file with its exact sibling
`Component.tsx` or `Component.astro`, then keeps the editor up to date as either
file changes. If both source siblings exist, Lasertag reports an ambiguity error.

## Features

- Warns when a selector cannot match any supported path through the component's
  render story (`dead-selector`).
- Warns when a module uses a local class other than the one exported as
  `css.class` (`impossible-local-class`).
- Completes root selectors, child and descendant tags, observed attributes and
  literal values, global escapes, and supported pseudo refinements from the
  sibling component's render story.
- Offers a quick fix and a command to remove diagnosed selectors safely from
  selector lists or whole rules.

Diagnostics are conservative. Dynamic or unsupported render paths are treated
as uncertain rather than reported as dead CSS.

## Install

Install Lasertag in your project, then build and install the current-platform
VSIX with the `code` command on your `PATH`:

```sh
pnpm add -D lasertag
pnpm lasertag vsix
```

Target another VS Code-compatible editor command when needed:

```sh
pnpm lasertag vsix --target code-insiders
```

Use `pnpm lasertag vsix --build-only` to create the VSIX without installing it;
the command reports the generated path.

## Commands

Open the Command Palette to run:

- **Lasertag: Clean up Dead Selectors** — applies the cleanup action to the
  active CSS Module.
- **Lasertag: Restart Lasertag Server** — restarts the language server used by
  the extension.

Both warning types also expose **Lasertag: Clean up Dead Selectors** as a Quick
Fix.

## Settings

All settings are optional. The bundled server and TypeScript runtime work
without configuration. Run **Developer: Reload Window** after changing a
setting; restarting the existing Lasertag client does not reload its extension
configuration.

| Setting                        | Default  | Purpose                                                                                                                                                            |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lasertag.lsp.path`            | `""`     | Path to a `lasertag-lsp` executable. Relative paths resolve from the first workspace root. When set, this takes precedence over `lasertag.server.path`.            |
| `lasertag.server.path`         | `""`     | Path to a language-server module. Leave empty to use the bundled server; ignored when `lasertag.lsp.path` is set.                                                  |
| `lasertag.typescript.sdk.path` | `""`     | Path to the TypeScript 7 native executable used for TSX analysis. Relative paths resolve from the first workspace root. Leave empty to use the bundled executable. |
| `lasertag.log.level`           | `"info"` | Operational logging: `off`, `error`, `warn`, `info`, or `debug`.                                                                                                   |
| `lasertag.trace.server`        | `"off"`  | Client/server protocol tracing: `off`, `messages`, or `verbose`. This is separate from operational logging.                                                        |

Operational logs and protocol traces appear in **View: Toggle Output** under
**Lasertag**.

## Troubleshooting

- If diagnostics or completions do not appear, check that the files use the
  exact sibling names `Component.tsx` or `Component.astro` and
  `Component.module.css`, then run
  **Lasertag: Restart Lasertag Server**.
- If the server does not start, clear custom `lasertag.lsp.path`,
  `lasertag.server.path`, and `lasertag.typescript.sdk.path` values to return to
  the bundled runtimes, then reload the window.
- For missing diagnostics or discovery problems, inspect the `analysis
  completed` summary in the **Lasertag** output. Set `lasertag.log.level` to
  `debug` and reload the window to include sibling source resolution, parsed
  selectors, the normalized render story, and per-selector reachability. Use
  `lasertag.trace.server: "verbose"` only when protocol-level detail is useful.
- Missing warnings can be intentional: Lasertag does not call a selector dead
  when an unsupported or dynamic render path could still reach it.
