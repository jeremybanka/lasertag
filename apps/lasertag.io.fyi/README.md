# lasertag.io.fyi

The Lasertag documentation website. This Astro app keeps documentation pages,
syntax-highlighted exhibits, responsive navigation, and Cloudflare deployment
self-contained while consuming the `lasertag` workspace package.

From the workspace root:

```sh
pnpm --filter lasertag.io.fyi dev
pnpm --filter lasertag.io.fyi build
pnpm --filter lasertag.io.fyi preview
```

Documentation content lives in `src/content/docs`, and code exhibits live in
`src/exhibits`.
