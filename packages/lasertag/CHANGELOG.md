# lasertag

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
