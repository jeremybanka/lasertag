# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

| Command            | Contract                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                                                                            |
| `check:fmt`        | Validate formatting without rewriting maintained files; language-specific validators are listed below.             |
| `check`            | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test`             | Run the normal test suite once and return a failing status when tests fail.                                        |
| `test:watch`       | Watch the available interactive test suites.                                                                       |
| `build`            | Build distributable artifacts.                                                                                     |
| `verify`           | Run the repository checks, tests, builds, and implemented coverage or compatibility gates.                         |
| `change`           | Author pending release notes.                                                                                      |
| `release:version`  | Prepare versions and release metadata without publishing.                                                          |
| `release:publish`  | Build as required by the release pipeline and publish packages.                                                    |
| `workflows:update` | Update pinned workflow tooling references.                                                                         |

## Static checks

- `check:eslint`: `vp run -r check:eslint`.
- `check:fmt`: `dprint check`.
- `check:vp`: `vp check --no-fmt`.
- `check:spelling`: `cspell .`.
- `check:tsc`: `tsc --noEmit`.

`check:vp` invokes the configured Vite Plus validation pipeline; `check:fmt` handles formatting separately.

## Verification

`pnpm run verify` executes `pnpm run check && pnpm run test && pnpm run build && pnpm run test:semver`. CI can run these constituent commands in separate jobs. Check failures must propagate to the caller.

Release compatibility checks need access to the Git remote and release tags.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
