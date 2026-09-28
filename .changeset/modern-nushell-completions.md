---
"lasertag": patch
---

Upgrade comline to 0.9.0. Lasertag's native Nushell completions now require Nushell 0.116.0 or newer and use named completion inputs to avoid positional-input deprecation warnings. After upgrading, reinstall existing completions with `lasertag completion install nushell` or regenerate manually managed files with `lasertag completion nushell`, then open a new shell.
