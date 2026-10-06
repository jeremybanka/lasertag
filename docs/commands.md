# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

Following the [mise Node.js cookbook](https://mise.jdx.dev/mise-cookbook/nodejs.html#add-node-modules-binaries-to-the-path), mise adds the repository root’s `node_modules/.bin` to `PATH`. With shell activation or `mise exec -- <tool>`, installed dependency CLIs are available from the root and package directories.

| Command            | Contract                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                                                                            |
| `check:fmt`        | Validate formatting without rewriting maintained files; language-specific validators are listed below.             |
| `check`            | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test`             | Run the normal test suite once and return a failing status when tests fail.                                        |
| `test:watch`       | Watch the available interactive test suites.                                                                       |
| `test:breaks`      | Check the latest release's public tests against the proposed implementation.                                       |
| `build`            | Build distributable artifacts.                                                                                     |
| `change`           | Author pending release notes.                                                                                      |
| `release:version`  | Prepare versions and release metadata without publishing.                                                          |
| `release:publish`  | Build as required by the release pipeline and publish packages.                                                    |
| `workflows:update` | Update pinned workflow tooling references.                                                                         |

## Static checks

- `check:eslint`: `vp run -r check:eslint`.
- `check:fmt`: `dprint check`.
- `check:vp`: `vp check --no-fmt`.
- `check:spelling`: `cspell .`.

`check:vp` runs linting and TypeScript typechecking through Vite Plus with `lint.options.typeAware` and `lint.options.typeCheck` enabled. `check:fmt` handles formatting separately.

## Command notes

`test:breaks` runs each package's Break Check configuration with verbose output and task caching disabled. It requires a clean Git working tree and access to the Git remote and release tags. Lasertag runs the released public tests directly against the proposed source implementation; a pending `lasertag` minor changeset certifies an intentional breaking change before 1.0.0.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
