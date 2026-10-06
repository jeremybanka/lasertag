# lasertag workspace

- This file is for project-level guidance for work in this repository. Keep Lasertag consumer guidance in `packages/lasertag/AGENTS.md`; move contributor, maintenance, release, or documentation-placement instructions here.
- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.
- Keep detailed Lasertag examples and edge-case guidance in `packages/lasertag/docs/lasertag-guide.md` and `packages/lasertag/docs/globals-guide.md`.
- Do not put line breaks in the bodies of changeset files; keep each changeset body on a single line.
- Before 1.0.0, use patch releases for features and bug fixes, and minor releases for breaking changes.
- Treat `packages/lasertag/tests/public/` as Lasertag's public non-breaking contract. It covers published CLI behavior, ESLint rule semantics, LSP completions and cleanup edits, and APIs exported from `lasertag/refractor`; keep its helpers and fixtures in that directory too.
- Keep implementation-focused coverage under `packages/lasertag/tests/private/` when it chiefly protects worker scheduling and cleanup, TypeScript session reuse, logs, corpus metadata, VS Code adapter or packaging mechanics, or experimental tooling. Those tests remain valuable under the ordinary `test` script and may evolve in a patch release.

## Vite Plus Upgrades

Use the target release's official `vp migrate --no-interactive` for Vite Plus upgrades. Preserve the old lockfile until migration runs, and let the migrator own toolchain version alignment and supported source/configuration changes. Review its manual migration findings and run the repository's formatter and checks; do not maintain a separate dependency synchronization implementation.

## Repository commands

Use the canonical command names in `docs/commands.md`: `fmt` writes formatting, `check` aggregates `check:*` validators, and `test` runs once. Coverage commands use the `cov` prefix where implemented. Keep CI and documentation references aligned when changing commands.

## Release compatibility

- Run released public contracts against source with break-check; do not build the package or run the current suite as a compatibility preflight.
- Run current tests, builds, and type checks independently in parallel CI jobs. Public-test commands run tests only.
- Disable compatibility-task caching and preserve the repository's intentional-break certification policy.
