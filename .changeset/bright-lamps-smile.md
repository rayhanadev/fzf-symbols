---
"@rayhanadev/truffler": minor
---

Include adjacent symbol comments in search output.

Symbols now expose adjacent `comments`, `commentStart`, and `commentEnd` metadata, and the CLI renders those comments in text and JSON output. Large comments are truncated in CLI output after 10 lines, and `truffler --version` now reports the version from `package.json`.
