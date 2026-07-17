# lasertag

## 0.5.3

### Patch Changes

- 860ed37: Collapse structurally equivalent sibling subtrees and duplicate possibilities in CLI and editor render story views.

## 0.5.2

### Patch Changes

- e82407f: Add a VS Code Render Story Activity Bar view with expanded complete parallel possibilities, aligned status icons and colors, CSS and source navigation, merged unreachable selector branches at their closest story location, and inline expect-error explanations.

## 0.5.1

### Patch Changes

- 1c77670: Group `lasertag check` warnings by CSS Module, show source-attached explanations with one line of surrounding context for up to ten affected files, and finish stylish output with a color-aware accounting summary. Add `--max-files` to choose another detail limit or show every affected file. Add `--show-story` for an opt-in view of the closest structural render possibilities, including a red `✕ you are here` branch where each dead selector expected to land.

## 0.5.0

### Minor Changes

- c48851c: Add Astro render story extraction and recognize same-named `.astro` files as CSS
  Module neighbors in the CLI, LSP, and VS Code extension. Report an error when
  both `.astro` and `.tsx` neighbors exist. Add LSP analysis summaries and debug
  traces for render-source resolution, normalized render stories, and selector
  reachability, and surface render-story analysis failures as editor errors.
  Preserve explicit children passed through Astro layout components and scope
  PascalCase component uncertainty beneath their Lasertag-conventional custom
  roots.
- c48851c: Discover render-story ownership roots from `css.class` attachments in TSX and
  Astro sources, excluding wrappers and unrelated sibling branches before CSS
  selector reachability analysis. Keep reachability unknown when no attachment is
  discoverable, leaving attachment convention errors to ESLint.

  Reuse unchanged render-source snapshots and selector reachability results across
  LSP diagnostics and analysis tracing, avoiding duplicate Astro/TSX parsing while
  retaining the detailed discovery trace.

## 0.4.4

### Patch Changes

- 9945588: Changed the Lasertag logo to work better at tiny scale. Now the four-pointed 'reticle' or 'light splash' around the central dot is less bulky and prominent.

## 0.4.3

### Patch Changes

- d1ecdc3: Add explained `@lasertag-expect-error` directives for expected CSS reachability diagnostics, stale-directive cleanup, and CSS comment autocomplete.

## 0.4.2

### Patch Changes

- 6b3f126: Document how to use Refractor, the CLI, the LSP, and the bundled VS Code extension, and clarify component tag-name guidance for exported and local components.
- b21a9aa: Build working VSCode extensions from installed Lasertag packages and resolve VSIX
  output directories from the directory where the CLI was invoked.

## 0.4.1

### Patch Changes

- 7bdd982: Run the CLI and language server when package managers launch their binaries
  through symlinked package paths.

## 0.4.0

### Minor Changes

- 2471aae: Implement `lasertag fix` with parallel dead-selector cleanup and Takua Chronicle
  progress output. Run both `check` and `fix` through a shared work-stealing
  scheduler, and make check warnings easier to scan with compact, colocated CSS
  source regions. Reuse one native TypeScript analysis session per worker to avoid
  restarting the parser for every component.

## 0.3.2

### Patch Changes

- 530513c: Clarify the consumer-facing agent guidance by moving project maintenance instructions out of the published package guidance.

## 0.3.1

### Patch Changes

- 5503ed1: Publish sourcemaps for bundled runtime code and declaration sourcemaps for the
  typed library entrypoints. The package now emits JavaScript maps for CLI, LSP,
  ESLint plugin, and refractor code while limiting generated declarations to the
  importable APIs that benefit from them.

## 0.3.0

### Minor Changes

- 822299d: Reshape the CLI around explicit `check`, `fix`, and `vsix` commands. Previously,
  bare `lasertag` validated CSS modules, `--fix` selected the cleanup stub, and
  `--vscode-install` installed a prebuilt VS Code extension artifact.

  Now, bare `lasertag` prints help, `lasertag check` validates CSS modules,
  `lasertag fix` keeps the existing cleanup stub, and `lasertag vsix` builds a
  current-platform VS Code extension from the installed SDK before installing it
  into the requested editor command.

### Patch Changes

- 822299d: Add a configurable TypeScript 7 native executable path for CLI validation and
  the VS Code extension. The extension exposes `lasertag.typescript.sdk.path` and
  forwards the resolved value to the language server as
  `LASERTAG_TYPESCRIPT_SDK_PATH`.
- 822299d: Bundle the TypeScript 7 JavaScript SDK into the VS Code language server bundle
  and package only the current platform's native TypeScript executable on disk.
  Empty `lasertag.typescript.sdk.path` settings now use that bundled native
  executable by default.

## 0.2.1

### Patch Changes

- 6bde285: Build the bundled VS Code extension entrypoint as ESM/MJS instead of CommonJS.

## 0.2.0

### Minor Changes

- 81f2086: Add the Refractor library for extracting TSX render stories and finding unreachable CSS Module selectors.
- 81f2086: Add the Lasertag LSP server for editor diagnostics powered by the shared Refractor library.
- 81f2086: Add the `lasertag` CLI for validating CSS Modules, stubbing fix mode, and installing the bundled VSCode extension from npm.
- 81f2086: Add the bundled Lasertag VSCode extension submodule with configurable LSP diagnostics for unreachable CSS Module selectors.

## 0.1.6

### Patch Changes

- aac890d: Add a `checkAllComponentFunctions` option to `render-tag-with-own-name` for checking local PascalCase component functions in addition to exported components.

## 0.1.5

### Patch Changes

- 2f79097: Improve ESLint rule diagnostics by including the specific expected CSS module import, CSS module binding, component export, or rendered root tag.

## 0.1.4

### Patch Changes

- 4db71e5: Tighten `render-tag-with-own-name` so exported components must return JSX whose outermost tag matches the component name, with no native form-control exception.
- b151a73: Report `name-imported-css-module-as-css` diagnostics on the offending import specifier name when one is provided.
- b151a73: Report `export-own-component-only` diagnostics on offending exported identifiers and clarify the rule message.
- b151a73: Report `header-main-footer-as-group` diagnostics on the offending JSX tag name instead of the whole element.
- b151a73: Report `render-tag-with-own-name` diagnostics on the mismatched JSX tag name instead of the whole returned element.
- 4db71e5: Update `render-tag-with-own-name` to validate every return path inside exported components, including returns nested in `if`, `switch`, and loop control flow.

## 0.1.3

### Patch Changes

- bff3c8a: Add an ESLint rule that restricts CSS module import member access to `class`.

## 0.1.2

### Patch Changes

- adc46f2: Recommend the ESLint plugin from AGENTS.md so agents can enforce conventions during onboarding.

## 0.1.1

### Patch Changes

- d9d6e7a: 🐛 The initial release accidentally bundled @eslint/core. This release does not.
