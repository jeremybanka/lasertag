# Lasertag Tooling

Lasertag's tooling shares one analysis engine: **Refractor** turns a component's
TSX or Astro template into a render story, compares that story with its CSS
Module, and reports selectors that cannot match or may cross an ownership
boundary. The CLI, language server, and VS Code extension are different surfaces
over that same conservative analysis.

For the authoring conventions these tools expect, see the
[Lasertag guide](./lasertag-guide.md).

## Choose a Surface

| Need                                                     | Surface                      |
| -------------------------------------------------------- | ---------------------------- |
| Embed analysis in another tool or inspect a render story | `lasertag/refractor`         |
| Check a repository or CI job without changing files      | `lasertag check`             |
| Deliberately remove diagnosed selectors                  | `lasertag fix`               |
| Add diagnostics and completions to another editor        | `lasertag-lsp`               |
| Use the bundled editor experience                        | Lasertag's VS Code extension |

## The Analysis Contract

Filesystem-facing tools use exact sibling pairs with the same stem:

```text
StatusCard.tsx
StatusCard.module.css
```

An exact `StatusCard.astro` sibling works in place of `StatusCard.tsx`. They do
not search for `.jsx` files, directory entrypoints, or differently named
components. The CLI skips a CSS Module without either exact source sibling, and
editor analysis has no render story to use until both files are available. If
both `.tsx` and `.astro` siblings exist, Lasertag reports an ambiguity error; it
does not silently choose one.

Refractor does not execute application code. It expands supported JSX branches
and local components into a render story. `children` render slots, imported
components, and render expressions it cannot resolve become opaque paths.
Foreign opaque paths carry ownership metadata so selectors that may match their
DOM can be distinguished from selectors that are merely inconclusive.
Unsupported selector shapes are unknown too.

For Solid TSX, Refractor recognizes imports from `solid-js` and lowers `Show`,
`For`, `Index`, `Switch`/`Match`, `ErrorBoundary`, `Suspense`, and
`SuspenseList` into their possible child branches. It also recognizes `Dynamic`
and `NoHydration` from `solid-js/web`. Aliased and namespace imports work;
similarly named user components are not given Solid semantics. Dynamic values
remain opaque. Recognized portal-style, out-of-tree rendering is excluded from
the component's descendant story.

Render-story ownership starts at the outermost rendered nodes whose `class` or
`class:list` expression uses `css.class`. Wrappers and unrelated sibling roots
are excluded before selector reachability runs. When Refractor cannot discover
an attachment, validation uses an opaque ownership root and makes no
dead-selector claims; ESLint is responsible for reporting a missing or misplaced
attachment.

That uncertainty is intentional: a selector is reported as dead only when every
supported path is provably unreachable. An unknown path prevents that report.
Independently, Refractor reports `selector-crosses-ownership-boundary` when a
selector can match a foreign component root or enter DOM supplied by an imported
component, render prop, slot, or `children`. This check is path-sensitive and can
report a selector that also has an ordinary reachable match in owned DOM.
Refractor also reports a local class other than `.class` as
`impossible-local-class`, because Lasertag CSS Modules expose only `css.class`.
Use `renderStory.warnings` and its opaque nodes when investigating why analysis
was conservative.

## Refractor API

Use `validateCssReachability` when a tool already has the two source texts:

```ts
import { validateCssReachability } from "lasertag/refractor"

const { diagnostics, renderStory } = validateCssReachability({
	cssPath: "src/StatusCard.module.css",
	cssSource: `
		status-card.class {
			> footer {}
		}
	`,
	tsxPath: "src/StatusCard.tsx",
	tsxSource: `
		import css from "./StatusCard.module.css"

		export const StatusCard = () => (
			<status-card className={css.class}>
				<strong>Ready</strong>
			</status-card>
		)
	`,
})

for (const warning of renderStory.warnings) console.warn(warning)
for (const diagnostic of diagnostics) console.error(diagnostic)
```

The result contains the render story plus `dead-selector`,
`impossible-local-class`, and `selector-crosses-ownership-boundary` diagnostics
with source ranges when available. Pass
`componentName` when a file contains multiple exported components and the main
component cannot be selected by convention. Reusing
`createTypescriptAstSession()` avoids starting a TypeScript AST session for every
file in a larger integration. Pass the session as the second argument to
`validateCssReachability`, then close it after the batch.

For either supported source type, use `validateRenderSourceCssReachability` with
`sourcePath` and `sourceText`. `analyzeAstroRenderStory` and
`analyzeTsxRenderStory` expose the individual source adapters, while
`analyzeRenderStory` dispatches from the source extension. Astro HTML and custom
elements are structural story nodes. Astro components whose names end in
`Layout` are transparent slot wrappers, so their explicit children remain in the
story long enough for attachment discovery. Other PascalCase Astro component
tags use Lasertag's own-name root convention (`Dz2Orbital` becomes
`dz2-orbital`) while their implementation stays opaque. Slots, injected HTML,
dynamic component tags, and expressions that cannot be reduced safely remain
opaque.

`scopeRenderStoryToCssClassRoots` exposes attachment-based scoping separately
for integrations that construct render stories themselves. It defaults to
`css.class`; pass `bindingName` and `exportName` to recognize another CSS Module
binding and export. Its low-level default preserves a story with no attachment;
pass `missingAttachment: "opaque"` for validation's conservative behavior.
The source adapters scope by default; pass `scopeToCssClassRoots: false` when a
tool needs the component's complete story, including return alternatives outside
the CSS Module's ownership root.

## CLI Workflows

`check` scans `**/*.module.css` by default and leaves files untouched:

```sh
pnpm lasertag check
pnpm lasertag check --format=json "src/**/*.module.css"
pnpm lasertag check --max-files=all
pnpm lasertag check --show-story
pnpm lasertag check "src/**/*.module.css,examples/**/*.module.css"
```

The target may also be a direct `.module.css` path. There is one positional target;
put multiple globs in one quoted, comma-separated value. By default Lasertag
ignores `node_modules`, `dist`, `build`, and `coverage`. A diagnostic or file
failure produces a nonzero exit code, which makes `check` suitable for CI. Use
`pnpm lasertag --help` for the current command syntax.

### Check output

The default `stylish` output groups warnings under their CSS Module. It shows
up to ten affected files in path order; `--max-files=all` shows every affected
file, and `--max-files=<number>` selects another positive limit. The cap only
affects human-readable detail: `--format=json` always returns every diagnostic.
Each warning includes one neighboring source line above and below its selected
range. Context stops at file boundaries and before a line selected by another
warning, keeping adjacent diagnostics distinct.

This is the reference appearance for a check with warnings:

```text
src/components/AppPanel.module.css  2 warnings
├─ 12:2  dead-selector
│  11 │   > header {}
│  12 │   > footer {}
│     │   ^^^^^^^^^^^
│  13 │   > action-row {}
│     ╰─ Selector "app-panel.class > footer" does not match any supported render story path.
│
└─ 28:2  impossible-local-class
   27 │   color: var(--color-accent);
   28 │   .secondaryAction {}
      │   ^^^^^^^^^^^^^^^^
   29 │ }
      ╰─ Local class ".secondaryAction" is unreachable; lasertag CSS modules expose only "css.class".

src/components/MenuPanel.module.css  1 warning
└─ 41:3  dead-selector
   40 │     > menu-item {}
   41 │     > menu-divider {}
      │     ^^^^^^^^^^^^^^^^^
   42 │   }
      ╰─ Selector "menu-panel.class > menu-divider" does not match any supported render story path.

… 4 more affected files containing 7 warnings

────────────────────────────────────────────────────────

▲ Check found 23 warnings in 14 files

  CSS modules  187 checked
       Detail   16 warnings in 10 files shown
       Hidden    7 warnings in 4 files

  Show everything with lasertag check --max-files=all
```

The hierarchy is intentionally restrained: file paths lead, tree rails connect
each warning to its compact source frame and explanation, and the summary
accounts for both visible and hidden detail. Interactive color may emphasize
status, selected source, and carets while neighboring context stays dim, but the
structure must remain legible without color.

Lasertag uses Node's `styleText` terminal API: paths are bold, diagnostic codes
are cyan, warning status and carets are yellow, clean status is green, and
structural rails and context are dim. Styling follows terminal support and the
`NO_COLOR`, `NODE_DISABLE_COLORS`, and `FORCE_COLOR` environment variables.

A clean check stays brief:

```text
✓ No dead CSS found in 187 files.
```

Pass `--show-story` to expand each displayed warning with up to three closest
render-story possibilities. The ordinary tree stays neutral, the closest real
node is yellow, and the selector's impossible continuation is inserted in red
with `✕ you are here`. Structural alternatives are numbered rather than given
speculative names or control-flow explanations. The flag affects stylish output
only when a dead selector has render-story evidence; default output stays compact.

`fix` mutates matched stylesheets, removing selectors reported as
`dead-selector` or `impossible-local-class`:

```sh
pnpm lasertag fix "src/**/*.module.css"
pnpm lasertag check "src/**/*.module.css"
```

Run it only when deletion is intended. Review the diff, then rerun `check`; a
nonzero result means a file failed or a diagnostic remained after cleanup.

The same CLI builds and installs the extension for the current platform:

```sh
pnpm lasertag vsix
pnpm lasertag vsix --target code-insiders
pnpm lasertag vsix --build-only
```

The default target is `code`. `--build-only` creates `Lasertag.vsix` without
calling an editor command.

When a `.module.css` file or its same-named `.tsx` or `.astro` neighbor is
active, the extension contributes a Lasertag Activity Bar view named **Render
Story**. Each numbered top-level item is one complete render possibility.
The story is expanded by default, and every row has an aligned semantic icon.
Branches with matching CSS use a regular-color pass icon and open the most
specific matching selector; branches without styles use an inactive
circle-slash or question icon and open their render-source tag. The view-title
actions jump directly between the component and its styles. The sidebar shows
the complete component story, so return alternatives outside `css.class` remain
visible as unsupported branches instead of empty possibilities; reachability
analysis remains scoped to CSS ownership.

Selectors that are styled but unreachable are inserted into each possibility
after their closest matching real branch. Shared unreachable prefixes are merged
into one branch. Unexpected continuations use the editor's warning color and
warning icon. A selector suppressed by
`@lasertag-expect-error` uses normal text with an info icon and shows the user's
explanation in VS Code's subdued secondary-text treatment. It still opens its
CSS location. The view materializes at most 48 possibilities so heavily
conditional components cannot make the editor unresponsive.

## Standalone Language Server

`lasertag-lsp` is a stdio language server. An editor client can launch it with:

```sh
pnpm exec lasertag-lsp --stdio
```

Configure the client to send `.module.css`, `.tsx`, and `.astro` documents,
provide the workspace folder, and synchronize create, change, and delete events
for `**/*.module.css`, `**/*.tsx`, and `**/*.astro`. The server registers those
watchers dynamically when the client supports it; otherwise the client should
forward watched-file notifications.

The server provides:

- `dead-selector`, `impossible-local-class`, and
  `selector-crosses-ownership-boundary` diagnostics in CSS Modules
- an `ambiguous-render-source` error when both source siblings exist
- render-aware selector, attribute, and refinement completions
- a cleanup code action whose edits remove dead or impossible selectors
- incremental updates when either side of a sibling pair changes

Two environment variables configure a standalone process:

| Variable                       | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `LASERTAG_TYPESCRIPT_SDK_PATH` | Path to the TypeScript 7 native executable used for TSX parsing |
| `LASERTAG_LSP_LOG_LEVEL`       | `off`, `error`, `warn`, `info`, or `debug`; defaults to `info`  |

The restart action uses the `lasertag.restartServer` command. Clients other than
the bundled VS Code extension must implement that client-side command if they
want to expose it.

## VS Code Extension

Install the extension shipped in the npm package with `pnpm lasertag vsix`. It
bundles `lasertag-lsp` and its TypeScript runtime, so the default installation
needs no path configuration. In addition to diagnostics and completions, the
Command Palette provides **Lasertag: Clean up Dead Selectors** and **Lasertag:
Restart Lasertag Server**.

| Setting                        | Purpose                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `lasertag.lsp.path`            | Use another `lasertag-lsp` executable; relative paths resolve from the first workspace root      |
| `lasertag.server.path`         | Use another server module; ignored when `lasertag.lsp.path` is set                               |
| `lasertag.typescript.sdk.path` | Use another TypeScript 7 native executable; relative paths resolve from the first workspace root |
| `lasertag.log.level`           | Operational logging: `off`, `error`, `warn`, `info`, or `debug`                                  |
| `lasertag.trace.server`        | Protocol tracing: `off`, `messages`, or `verbose`                                                |

## Troubleshooting

- If a CSS Module has no diagnostics or completions, first verify the exact
  `.module.css` and `.tsx` or `.astro` sibling names and that both files are
  inside the workspace.
- The main component is selected from a matching file-stem export, then a default
  export, then a single exported component. Resolve ambiguous exports or use
  `componentName` through the refractor API.
- No diagnostic can mean “unknown,” not “reachable.” Inspect the API's render
  story when dynamic or imported render branches are involved. The `info` log
  includes an analysis summary with element, opaque-branch, selector, and
  reachability counts. At `debug`, Lasertag logs sibling resolution, parsed CSS
  selectors, the normalized render story, and every selector path's
  `reachable`, `unknown`, or `unreachable` result.
- In VS Code, open the **Lasertag** output channel, set
  `lasertag.log.level` to `debug`, and use `lasertag.trace.server` only when
  protocol messages are needed. Run **Developer: Reload Window** after changing
  any extension setting; the restart command does not rebuild the client's
  configuration.
- A custom TypeScript SDK path points to the TypeScript 7 native executable, not
  its containing package directory.
