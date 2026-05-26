---
"@rayhanadev/truffler": minor
---

Persist per-project symbol indexes under the user's home directory so repeated scans can reuse cached symbols for unchanged files and only reparse files whose content changed.

Scanner errors now throw typed `Error` subclasses instead of flowing through an `onError` callback, and the CLI no longer exposes the parser-diagnostic `--verbose` flag.
