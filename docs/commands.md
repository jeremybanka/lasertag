# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

Following the [mise Node.js cookbook](https://mise.jdx.dev/mise-cookbook/nodejs.html#add-node-modules-binaries-to-the-path), mise adds the repository root’s `node_modules/.bin` to `PATH`. With shell activation or `mise exec -- <tool>`, installed dependency CLIs are available from the root and package directories.

| Command            | Contract                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                                                                            |
| `check:fmt`        | Validate formatting without rewriting maintained files; language-specific validators are listed below.             |
| `check`            | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test`             | Run the normal test suite once and return a failing status when tests fail.                                        |
| `test:breakage`    | Replay the latest released public consumer contracts against current source.                                       |
| `test:watch`       | Watch the available interactive test suites.                                                                       |
| `build`            | Build distributable artifacts.                                                                                     |
| `change`           | Author pending release notes.                                                                                      |
| `release:version`  | Prepare versions and release metadata without publishing.                                                          |
| `release:publish`  | Build as required by the release pipeline and publish packages.                                                    |
| `workflows:update` | Update pinned workflow tooling references.                                                                         |

## Test execution

CI runs `test` in four shards, each with at most two test workers because integration tests also start native compilers and content mapper processes. Reproduce one shard with `pnpm --filter lasertag run test --shard=1/4`. The aggregate `Vitest` check requires every shard to pass, including when a shard fails or is canceled. `test:breakage` retains the complete public compatibility suite and uses the same worker limit.

Tests that compare multiple real CLI or LSP sessions have an explicit 20-second scenario budget. Individual process and request deadlines, assertions, and production mapper timeouts remain unchanged; retries are not enabled.

## Static checks

- `check:eslint`: `vp run -r check:eslint`.
- `check:fmt`: `dprint check`.
- `check:vp`: `vp check --no-fmt`.
- `check:spelling`: `cspell .`.

`check:vp` runs linting and TypeScript typechecking through Vite Plus with `lint.options.typeAware` and `lint.options.typeCheck` enabled. `check:fmt` handles formatting separately.

## Experimental Astro benchmark

The Astro and CSS benchmarks use the Lasertag website corpus, maintained separately from the package. If it is absent from this checkout, set `LASERTAG_BENCHMARK_SITE_PATH` to an installed `apps/lasertagcss.com` directory from a website checkout. The commands copy its authored inputs into a temporary project and leave the original files untouched.

Run `pnpm --silent --filter lasertag benchmark:astro --runExternalCode --iterations 10` to compare template analysis with the official Astro content mapper on an isolated copy of the website. The command executes the pinned development mapper and writes JSON results to stdout. See the [Astro validation notes](../packages/lasertag/docs/astro-support-plan.md#official-mapper-validation) for scope, correctness assertions, and interpretation.

## CSS ownership benchmark

Run `pnpm --silent --filter lasertag benchmark:css --runExternalCode --iterations 5` to resolve class attachments through the pinned development CSS and Astro mappers in an isolated copy of the website. It checks stories, CSS diagnostics, completion results, cleanup ranges, and authored declaration locations, then writes coverage and timing samples as JSON to stdout. It also measures at least thirty samples each of unchanged requests, unique TSX/Astro edits, import renames, unsaved CSS edits, and alternating edited documents. The [CSS mapper validation notes](../packages/lasertag/docs/render-story-css-validation-plan.md#css-mapper-ownership-analysis) describe the evidence and its limits. For the shipped integration, run `pnpm lasertag check --css-ownership --format=json` or `pnpm lasertag fix --css-ownership` in a configured trusted project. The development inspector `node scripts/inspect-css-ownership.node.ts --runExternalCode path/to/AppPanel.tsx` (or `.astro`) also exposes the raw evidence. These commands execute project-configured mappers; ordinary analysis remains unchanged.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
