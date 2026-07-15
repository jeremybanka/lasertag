# Render Story Visualizer Experiments

`dead-selector` can prove that a selector matches no supported render story, but
the next useful question is where that selector expected to land. A detailed
view should show the failed location without making alternate renders look like
simultaneous siblings.

The experimental ANSI gallery lives in
`tests/cli/render-story-visualizer.experimental.test.ts`. It uses three scenarios:

- a profile selector with a misspelled `avater` tag, where `avatar` exists in
  only the ready reality;
- an inbox selector with `message-row` at the wrong depth, where the missing
  `message-list` step is visible in the populated reality;
- a checkout `error-banner` absent from every modeled reality, suggesting stale
  CSS or an unimplemented state rather than a spelling correction.

Concept A is now available in production stylish output through
`lasertag check --show-story`. Concepts B and C remain product explorations.

## Concepts

### A. Story atlas

Stack complete realities vertically and mark only the closest rendered node.
Insert the selector's impossible continuation into each tree in red, ending with
`✕ you are here`; leave the surrounding tree neutral. This is the strongest
default: it fits narrow terminals, preserves tree structure, scales to uneven
realities, and has room for a specific likely fix without offering a speculative
control-flow explanation.

### B. Path evidence

Reduce each reality to the path most relevant to the failed selector. A small
structural diff can expose an omitted ancestor or wrong combinator immediately.
This is the strongest companion to the atlas when Lasertag can identify a useful
near match.

### C. Reality lanes

Place complete realities in side-by-side columns. This makes their independence
unmistakable and comparison delightful, but it needs a wide terminal and should
fall back to the atlas when lines would wrap.

## Design constraints

- Say **parallel realities**, not branches of one DOM tree.
- Give every reality its own boundary and its selecting condition.
- Distinguish an exact rendered path, a near match, and an unknown or opaque path.
- Suggest a correction only when the evidence is strong; absence alone is not a
  typo.
- Keep the selector and conclusion readable after ANSI styling is removed.
- Prefer source locations on reality labels and nodes once the production render
  story exposes enough range information.

The likely production shape is Concept A followed by Concept B only when a near
match is available. Concept C is a compelling wide-terminal alternative rather
than the universal layout.
