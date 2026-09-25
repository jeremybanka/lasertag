---
"lasertag": patch
---

Respect React's explicit JSX children precedence over prop spreads when project JSX settings or file directives establish React as the consumer, avoiding false ownership warnings for local components, fragments, and asserted roots while preserving conservative spread-only, Solid, and unknown-runtime analysis.
