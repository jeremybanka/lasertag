---
"lasertag": patch
---

Respect React's explicit JSX children precedence over prop spreads using declared automatic JSX providers and verified direct React factory imports, including import aliases and lexical shadowing; avoid false ownership warnings for local components, fragments, and asserted roots while preserving conservative spread-only, Solid, and unknown-runtime analysis and documenting the supported detection boundary.
