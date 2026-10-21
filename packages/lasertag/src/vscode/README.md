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
- Adds a Lasertag Activity Bar view while a CSS Module or its same-named render
  source is active. **Render Story** shows each parallel possibility as its own
  nested tree, expanded by default. Every row has an aligned semantic icon.
  Regular-color pass branches have matching styles and open those styles when
  selected; inactive circle-slash or question branches have no known matching
  style and open their JSX or Astro source.
- Inserts styled selectors that no render possibility can reach at the closest
  matching location inside each tree. Warning-colored branches use a warning
  icon; regular-color branches with an info icon show the user's
  `@lasertag-expect-error` explanation as subdued secondary text. Every inserted
  branch opens its selector in the CSS Module.
- Offers a quick fix and a command to remove diagnosed selectors safely from
  selector lists or whole rules.
- Offers automatic Astro component navigation: **Go to Definition** opens source
  targets; **Go to Declaration** opens ambient type declarations.
- Shows **CSS ownership** in the sidebar when project-configured mappers resolve
  `css.class` to authored stylesheets. Expand a reference and click its stylesheet
  target to open the declaration, including unsaved edits.

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
install the exact generated path printed by the command, then run
**Developer: Reload Window**.

## Enable CSS ownership and Astro navigation

The extension bundles TypeScript `7.1.0-beta`. Install these tested mapper versions
in your project:

```sh
pnpm add -D css-modules-content-mapper@0.1.1 @astrojs/ts-content-mapper@0.2.0
```

Register them at the top level of the component's `tsconfig.json`, alongside
`compilerOptions`:

```json
{
	"contentMappers": [
		{ "package": "css-modules-content-mapper", "extensions": [".module.css"] },
		{ "package": "@astrojs/ts-content-mapper", "extensions": [".astro"] }
	]
}
```

TSX-only projects need only the CSS mapper. The mapper packages must resolve from
the configured project. You can keep your project's existing TypeScript version;
Lasertag uses its bundled runtime. Running a separate `tsc` with these mappers
requires a compatible compiler and `--runExternalCode`.

In a trusted workspace these registrations enable the features automatically;
there are no additional Lasertag feature settings. Restricted workspaces retain
ordinary structural analysis. Granting trust restarts the server automatically.

Open a component and its same-named CSS Module, then open the Lasertag Activity
Bar view. Under **CSS ownership**, expand `css.class` and click its stylesheet
target. `sibling` means the expected CSS Module; `foreign` means another stylesheet.
In an Astro file, use **Go to Definition** on an imported component tag to open
its source. **Output → Lasertag** confirms the runtime version; ownership targets
confirm that the project mapper produced stylesheet evidence.

## Commands

Open the Command Palette to run:

- **Lasertag: Clean up Diagnostics** — applies the cleanup action to the
  active CSS Module.
- **Lasertag: Open Styles** — opens the active component's CSS Module. This is
  also available from the Render Story view title.
- **Lasertag: Open Render Source** — opens the active component's same-named
  `.tsx` or `.astro` file. This is also available from the Render Story view
  title.
- **Lasertag: Restart Lasertag Server** — restarts the language server used by
  the extension.

Both warning types also expose **Lasertag: Clean up Diagnostics** as a Quick
Fix.

## Settings

All settings are optional. The bundled server and TypeScript runtime work
without configuration. Run **Developer: Reload Window** after changing
settings; restarting the existing Lasertag client does not reload those settings.

| Setting                        | Default  | Purpose                                                                                                                                                            |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lasertag.lsp.path`            | `""`     | Path to a `lasertag-lsp` executable. Relative paths resolve from the first workspace root. When set, this takes precedence over `lasertag.server.path`.            |
| `lasertag.server.path`         | `""`     | Path to a language-server module. Leave empty to use the bundled server; ignored when `lasertag.lsp.path` is set.                                                  |
| `lasertag.typescript.sdk.path` | `""`     | Path to the TypeScript 7 native executable used for TSX analysis. Relative paths resolve from the first workspace root. Leave empty to use the bundled executable. |
| `lasertag.log.level`           | `"info"` | Operational logging: `off`, `error`, `warn`, `info`, or `debug`.                                                                                                   |
| `lasertag.trace.server`        | `"off"`  | Client/server protocol tracing: `off`, `messages`, or `verbose`. This is separate from operational logging.                                                        |

Operational logs and protocol traces appear in **View: Toggle Output** under
**Lasertag**.

At the default `info` log level, startup reports the extension version, server
and TypeScript executable paths (bundled or overridden), the selected native
compiler's version, and whether workspace trust permits content mappers.
Mapper permission alone does not confirm that a project's mappers resolved;
inspect **CSS ownership** in the sidebar to verify stylesheet evidence.

## Astro navigation

In a trusted workspace, Lasertag automatically permits
TypeScript to execute the project's configured content mappers when you navigate
from an Astro component tag. The compiler session is reused, including unsaved
source and dependency edits, and released when the last Astro document closes.

**Go to Definition** follows source declarations, including aliases and namespace
members. A mapped Astro component without a precise range opens at the beginning
of its source file. **Go to Declaration** follows ambient declarations; an MDX
`Content` type declaration does not establish the MDX implementation. Unresolved
or conflicting mappings return no target. Render stories, CSS diagnostics,
completions, and cleanup continue to use the template parser.

## CSS ownership analysis

Install and register `css-modules-content-mapper` for `.module.css` in the
project's `contentMappers` configuration. Astro files also need the Astro mapper
shown above. Lasertag uses these registrations automatically in trusted workspaces.

Diagnostics, completions, cleanup, and the sidebar share the mapped story while
retaining existing structural rules. The **CSS ownership** section shows each
class reference's status and lets you open verified authored stylesheet targets.
Unsaved stylesheets and imported bindings participate in analysis. Missing or
failed evidence stays unverified or unavailable; worker failures fall back to
ordinary analysis. The feature does not permit extra local classes or change
cleanup decisions.

## Troubleshooting

- If **CSS ownership** is missing, verify the mapper installation and the nearest
  `tsconfig.json` for the component, including any inherited configuration. Astro
  ownership needs both mappers. Restart Lasertag after changing mapper installation
  or configuration. Ordinary CSS diagnostics alone do not prove mapper activation.
- If Astro navigation returns no target, check that the editor's language mode is
  **Astro** and that the import resolves under the project's module resolution
  settings. Ambient declarations support **Go to Declaration**, not source navigation.
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

## License

Lasertag is free and open-source software under the Mozilla Public License 2.0.
MPL 2.0 permits use for any purpose and combination with open or proprietary
code. Its share-back requirement applies at the file level: when you distribute
changes to MPL-covered files, make those files' source available under MPL 2.0;
separate files remain under terms of your choice. See Mozilla's
[official MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) for the
plain-language explanation and the included `LICENSE` file for the full terms.
