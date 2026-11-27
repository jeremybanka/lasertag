---
"lasertag": minor
---

Report `selector-segment-without-tag` for any selector segment that names no tag. These selectors were skipped without comment, so `lasertag check` now fails on modules that used to pass. Fails: `tool-bar.class { > [data-active] {} :hover {} }`. Blessed: start each segment with the tag it selects, and use `&` to qualify the parent: `tool-bar.class { > button[data-active] {} &:hover {} }`. A segment that comes before the root, as in `[data-theme="dark"] tool-bar.class {}`, selects an element outside the component and goes in `:global(...)`: `:global([data-theme="dark"]) tool-bar.class {}`. The message names the element when the render story identifies it, `lasertag fix` leaves these selectors alone, and neither `@lasertag-expect-error` nor `@lasertag-disable` suppresses the diagnostic.
