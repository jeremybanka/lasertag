---
"lasertag": minor
---

Report `selector-segment-without-tag` for a selector segment that names no tag, such as `> [data-open]` or a nested `:hover`; these selectors were previously skipped without comment. The diagnostic names the element when the render story identifies it, and suppression directives do not apply to it. Stop analyzing `@keyframes` offsets as selectors, which reported `from` and `to` as dead.
