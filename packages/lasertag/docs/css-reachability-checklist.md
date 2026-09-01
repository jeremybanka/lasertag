# CSS Reachability Hardening Checklist

Status: complete

This checklist tracks selector and render-story cases that should be covered
before refractor starts powering the CLI and LSP diagnostics in earnest.

## Selector Refinements

- [x] `&:pseudo-class` selectors on a reachable host
- [x] selectors nested beneath `&:pseudo-class`
- [x] `&::pseudo-element` selectors on a reachable host
- [x] selectors nested beneath `&::pseudo-element`
- [x] transparent functional pseudo-class refinements such as `:not(...)` and
      `:nth-child(...)`
- [x] `:is(...)` and `:where(...)` with tag alternatives
- [x] attribute selectors on reachable hosts and descendants

## Escapes And Unknowns

- [x] `:global(...)` as an explicit external escape hatch
- [x] wildcard selectors such as `*`
- [x] tagless selectors such as `[role="button"]`
- [x] unsupported sibling combinators `+` and `~`
- [x] unsupported `:has(...)`
- [x] unsupported namespace selectors

## Nesting And At-Rules

- [x] selector-list entries validated independently
- [x] multiple root selector alternatives
- [x] nested selectors inside `@media`, `@supports`, `@container`, and `@layer`
- [x] nested ampersand selectors such as `& &`
- [x] selectors that use `&` inside `:is(...)` or `:where(...)`

## Render Story Boundaries

- [x] imported component branches are opaque, not dead
- [x] `{children}` branches are opaque, not dead
- [x] render-prop calls are opaque, not dead
- [x] portal or other unsupported render calls are opaque, not dead

## Verification

Covered by `tests/public/refractor/css-reachability.test.ts` and verified with:

- `pnpm --filter lasertag test -- tests/public/refractor/css-reachability.test.ts`
- `pnpm --filter lasertag test`
- `pnpm check`
- `pnpm fmt:check`
- `pnpm --filter lasertag build`
