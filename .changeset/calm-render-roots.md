---
"lasertag": minor
---

Discover render-story ownership roots from `css.class` attachments in TSX and
Astro sources, excluding wrappers and unrelated sibling branches before CSS
selector reachability analysis. Keep reachability unknown when no attachment is
discoverable, leaving attachment convention errors to ESLint.
