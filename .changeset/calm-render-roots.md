---
"lasertag": minor
---

Discover render-story ownership roots from `css.class` attachments in TSX and
Astro sources, excluding wrappers and unrelated sibling branches before CSS
selector reachability analysis. Keep reachability unknown when no attachment is
discoverable, leaving attachment convention errors to ESLint.

Reuse unchanged render-source snapshots and selector reachability results across
LSP diagnostics and analysis tracing, avoiding duplicate Astro/TSX parsing while
retaining the detailed discovery trace.
