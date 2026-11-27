---
"lasertag": patch
---

Fix tag completions for a selector with a comment above it. The comment was read as part of the selector, so typing `> ` on the line under `/* layout */` inside `tool-bar.class {}` completed nothing; it now completes the root's child tags, and the same holds inside a rule that has a comment above it. No completion that worked before is withdrawn.
