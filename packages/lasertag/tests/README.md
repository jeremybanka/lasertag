# Test contracts

`public/` holds the behavior Lasertag promises not to break in a patch release. Break Check restores these tests from the latest release and runs them against the proposed implementation.

Run `pnpm run test:breaks` from the repository root or this package to use the package's [Break Check configuration](../break-check.config.json). The restore pattern includes public helpers and fixtures as well as test files so the released contract stays self-contained. Break Check runs `test:public` directly against the current source implementation and restores the original public files afterward. An intentional breaking change requires a pending `lasertag` minor changeset before 1.0.0.

`private/` holds implementation-level coverage that remains important for maintenance but may change along with the implementation in a patch release. Examples include worker scheduling, TypeScript session reuse, corpus metadata, protocol plumbing, packaging, and experimental tooling.
