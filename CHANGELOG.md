# truffler

## 0.4.0

### Minor Changes

- 7969fad: Persist per-project symbol indexes under the user's home directory so repeated scans can reuse cached symbols for unchanged files and only reparse files whose content changed.

  Scanner errors now throw typed `Error` subclasses instead of flowing through an `onError` callback, and the CLI no longer exposes the parser-diagnostic `--verbose` flag.

## 0.3.0

### Minor Changes

- d3d40be: Include adjacent symbol comments in search output.

  Symbols now expose adjacent `comments`, `commentStart`, and `commentEnd` metadata, and the CLI renders those comments in text and JSON output. Large comments are truncated in CLI output after 10 lines, and `truffler --version` now reports the version from `package.json`.

- b90c0f1: Rename the package to `@rayhanadev/truffler` and the CLI binary to `truffler`.

  Install the package with `bun add @rayhanadev/truffler`, run one-off searches with `bunx @rayhanadev/truffler`, and use the `truffler` command once installed.

## 0.2.1

### Patch Changes

- a58aa7e: Show options for `kind` in help text

## 0.2.0

### Minor Changes

- d356244: Include enclosing class/objects for properties/methods in output.

## 0.1.2

### Patch Changes

- c6bc0b6: Remove other extraneous symbols from default view in CLI.

## 0.1.1

### Patch Changes

- d2a8211: No longer includes constants/variables by default when running truffler CLI.

## 0.1.0

### Minor Changes

- 6914d2c: Initial commit
