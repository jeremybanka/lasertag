---
"lasertag": patch
---

Preserve potentially live CSS during JSX cleanup by retaining unknown component identities, respecting shadowed component and portal bindings, keeping replacement uncertainty through CSS-root scoping, and honoring explicit children and spread precedence in framework components including Solid Dynamic. Recognize equivalent supported wrapper syntax and retain directive diagnostics in comment-only JSX bodies. Preserve uncertain local output beside known CSS roots, distinguish render values and custom namespaces from framework fragments, honor Solid undefined prop fallthrough, and exclude non-component constants from main-component selection.
