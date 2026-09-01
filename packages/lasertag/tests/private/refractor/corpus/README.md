# Refractor Render Corpus

This directory describes the optional upstream corpus used to harden the render
story extractor against real JSX patterns.

The checked-in manifest pins release versions only. Provider source files are
fetched into `providers/`, which is intentionally gitignored. Default tests use
the public golden fixtures under `../../../public/refractor/fixtures/golden`;
this corpus is for
deeper local and scheduled CI runs.

Fetch provider files from the workspace root:

```sh
pnpm refractor:corpus
```

Preview the configured providers without network access:

```sh
pnpm refractor:corpus --dry-run
```

Run the corpus sweep and write JSON/Markdown reports:

```sh
pnpm refractor:corpus:test
```

The sweep fetches missing or stale providers by default. Use `--no-fetch` when
you want the command to validate only the files that are already present in
`providers/`.
