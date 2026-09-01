# Test contracts

`public/` holds the behavior Lasertag promises not to break in a patch release. Its helpers and fixtures live beside the contract tests so the suite remains self-contained.

`private/` holds implementation-level coverage that remains important for maintenance but may change along with the implementation in a patch release. Examples include worker scheduling, TypeScript session reuse, corpus metadata, protocol plumbing, packaging, and experimental tooling.
