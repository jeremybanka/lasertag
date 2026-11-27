---
"lasertag": minor
---

Stop the language server completing selectors that `selector-segment-without-tag` rejects. Fails: the bare `:hover`, `:focus-visible`, `::before` and `::after` completions at the start of a nested selector or after a combinator, and the bare `.class` completion at the top level, are no longer offered. Blessed: at the start of a nested selector, complete `&:hover`, which also replaces a `:` already typed; after `> `, complete the tag first and then its refinement, as in `> button:hover`; at the top level, complete `tool-bar.class`. After a colon, only refinements are offered, never tags.
