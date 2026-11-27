---
"lasertag": minor
---

Analyze selectors that contain a comment; a comment used to hide the whole selector from analysis. Fails: `tool-bar.class { > em /* note */ {} }` in a component that renders no `em`, now reported as `dead-selector` and removed by `lasertag fix`. Blessed: delete the dead rule, or, when the element really is added at runtime, put `/* @lasertag-expect-error: <reason> */` on the line above it.
