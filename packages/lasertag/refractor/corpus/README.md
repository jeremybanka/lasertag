# Refractor Render Corpus

This directory describes the optional upstream corpus used to harden the render
story extractor against real JSX patterns.

The checked-in manifest pins release versions only. Provider source files are
fetched into `providers/`, which is intentionally gitignored. Default tests use
the smaller golden fixtures under `refractor/tests/fixtures/golden`; this corpus
is for deeper local and scheduled CI runs.

Fetch provider files from the workspace root:

```sh
pnpm refractor:corpus
```

Preview the configured providers without network access:

```sh
pnpm refractor:corpus --dry-run
```
