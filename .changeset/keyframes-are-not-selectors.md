---
"lasertag": patch
---

Stop analyzing `@keyframes` offsets as selectors. `@keyframes fade { from { opacity: 0; } to { opacity: 1; } }` reported `from` and `to` as `dead-selector`, and `lasertag fix` deleted both steps; it now passes and is left alone. Fails: an `@lasertag-expect-error` written above `from` or `to` to excuse that report is now an `unused-expect-error`. Blessed: delete the directive, or let `lasertag fix` remove it.
