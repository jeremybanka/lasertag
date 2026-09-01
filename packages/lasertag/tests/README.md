# Test contracts

`public/` holds the behavior Lasertag promises not to break in a patch release. Break Check restores these tests from the latest release and runs them against the proposed implementation.

`private/` holds implementation-level coverage that remains important for maintenance but may change along with the implementation in a patch release. Examples include worker scheduling, TypeScript session reuse, corpus metadata, protocol plumbing, packaging, and experimental tooling.
