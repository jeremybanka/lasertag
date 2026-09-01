# lasertag workspace

- This file is for project-level guidance for work in this repository. Keep Lasertag consumer guidance in `packages/lasertag/AGENTS.md`; move contributor, maintenance, release, or documentation-placement instructions here.
- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.
- Keep detailed Lasertag examples and edge-case guidance in `packages/lasertag/docs/lasertag-guide.md` and `packages/lasertag/docs/globals-guide.md`.
- Do not put line breaks in the bodies of changeset files; keep each changeset body on a single line.
- Before 1.0.0, use patch releases for features and bug fixes, and minor releases for breaking changes.
- Treat `packages/lasertag/tests/public/` as Lasertag's public non-breaking contract. It covers published CLI behavior, ESLint rule semantics, LSP completions and cleanup edits, and APIs exported from `lasertag/refractor`; keep its helpers and fixtures in that directory too.
- Keep implementation-focused coverage under `packages/lasertag/tests/private/` when it chiefly protects worker scheduling and cleanup, TypeScript session reuse, logs, corpus metadata, VS Code adapter or packaging mechanics, or experimental tooling. Those tests remain valuable under the ordinary `test` script and may evolve in a patch release.
