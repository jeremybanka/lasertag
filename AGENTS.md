# lasertag workspace

- This file is for project-level guidance for work in this repository. Keep Lasertag consumer guidance in `packages/lasertag/AGENTS.md`; move contributor, maintenance, release, or documentation-placement instructions here.
- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.
- Keep detailed Lasertag examples and edge-case guidance in `packages/lasertag/docs/lasertag-guide.md` and `packages/lasertag/docs/globals-guide.md`.
- Do not put line breaks in the bodies of changeset files; keep each changeset body on a single line.
- Before 1.0.0, use patch releases for features and bug fixes, and minor releases for breaking changes.
