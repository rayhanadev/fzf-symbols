# truffler

Fast fuzzy symbol search for JavaScript and TypeScript codebases, powered by [`oxc-parser`](https://oxc.rs).

`truffler` scans source files, extracts declarations, fuzzy-ranks matching symbols, and returns output that is readable by humans and useful to AI tools.

## Install

```bash
bun add @rayhanadev/truffler
```

Run the CLI without installing it into a project:

```bash
bunx @rayhanadev/truffler Button
```

## Install the Skill

This repository includes a skill that helps agents use `truffler` before writing JavaScript or TypeScript code, so they can find similar/pre-existing functions and avoid duplicate helpers.

Install it from this repository with Vercel's Skills CLI:

```bash
npx skills add rayhanadev/truffler --skill find-similar-functions
```

The skill expects the `truffler` CLI to be available in the target project or runnable with `bunx @rayhanadev/truffler`.

## CLI

Search for symbols in a file or directory:

```bash
truffler Button src
truffler btn test/fixtures/sample.tsx --kind function,class --limit 10
truffler props src --kind interface
truffler button src --format json
```

Options:

- `--limit`, `-l`: maximum results to print, default `50`.
- `--format`, `-f`: output format. Options: `text`, `json`. Default: `text`.
- `--kind`, `-k`: comma-separated symbol kinds to include. Default: `class`, `enum`, `function`, `interface`, `method`, `property`, `type`. Options: `class`, `constant`, `enum`, `enum-member`, `export`, `function`, `import`, `interface`, `method`, `property`, `type`, `variable`.
- `--verbose`: print parser and file diagnostics.

Text output is grouped by file and rendered as a compact code outline:

````text
src/button.tsx
```tsx
  11 | /** Renders the primary button action. */
  12 | export function Button(props: ButtonProps) {
  13 |   ...
  16 | }

  19 | // Public props accepted by Button.
  20 | export interface ButtonProps {
  21 |   label: string;
  22 |   onClick(): void;
  23 | }
```
````

Adjacent comments are included with matching symbols. Comments longer than 10 lines are truncated with a summary line.

Method and property matches include their enclosing class or object context:

````text
src/button.tsx
```tsx
  10 | export class ButtonController {
     |   ...
  13 |   /** Handles user interaction. */
  14 |   handleClick(): void {}
  15 | }

  18 | const buttonHelpers = {
     |   ...
  21 |   // Default size when no explicit prop is provided.
  22 |   defaultSize: ButtonSize.Small,
  23 | };
```
````

Large interfaces show the first 15 properties and then summarize the rest:

````text
src/button.tsx
```tsx
   8 | export interface MegaButtonProps {
   9 |   prop01: string;
  10 |   prop02: string;
  11 |   prop03: string;
  12 |   prop04: string;
  13 |   prop05: string;
  14 |   prop06: string;
  15 |   prop07: string;
  16 |   prop08: string;
  17 |   prop09: string;
  18 |   prop10: string;
  19 |   prop11: string;
  20 |   prop12: string;
  21 |   prop13: string;
  22 |   prop14: string;
  23 |   prop15: string;
     |   (...and 3 more properties)
  27 | }
```
````

## Indexing

`truffler` persists a per-project symbol index under `~/.truffler/projects/<path-to-project-with-dashes>/symbols.json`.

Each scan still discovers matching files, but unchanged files reuse cached `SymbolRecord` data instead of being read and parsed with `oxc-parser`. When file metadata changes, `truffler` hashes the file content; if the hash matches the cached entry, it refreshes metadata without reparsing. Only files with changed content are reindexed.

JSON output wraps matches with query context for programmatic use:

```json
{
  "query": "btn",
  "root": "src",
  "count": 1,
  "results": [
    {
      "name": "Button",
      "kind": "function",
      "location": { "file": "src/button.tsx", "line": 12, "column": 17 },
      "signature": "function Button(props: ButtonProps)",
      "declarationStart": 120,
      "declarationEnd": 196,
      "commentStart": 76,
      "commentEnd": 115,
      "comments": ["/** Renders the primary button action. */"],
      "signatureStart": 120,
      "signatureEnd": 164,
      "parameters": [{ "name": "props", "type": "ButtonProps", "optional": false, "rest": false }],
      "snippet": "export function Button(props: ButtonProps) {",
      "score": 61.96,
      "matches": [0, 2, 5]
    }
  ]
}
```

## SDK

Use `searchSymbols` when you want ranked fuzzy matches, or `scanSymbols` when you want the full symbol index.

```ts
import { extractSymbolsFromSource, scanSymbols, searchSymbols } from "@rayhanadev/truffler";

const results = await searchSymbols("btn", {
  root: "src",
  limit: 20,
  symbolKinds: ["function", "class", "interface"],
});

const allSymbols = await scanSymbols({ root: "src" });

const symbolsFromMemory = extractSymbolsFromSource(
  "component.tsx",
  "export function Button() { return null; }",
);
```

### Result Shape

Search results include the symbol identity, location, adjacent comments when available, declaration span, signature span, parsed parameters, a source snippet, score, and matched character positions.

```ts
interface SymbolSearchResult {
  name: string;
  kind: SymbolKind;
  file: string;
  start: number;
  end: number;
  declarationStart?: number;
  declarationEnd?: number;
  commentStart?: number;
  commentEnd?: number;
  comments?: string[];
  signatureStart?: number;
  signatureEnd?: number;
  line?: number;
  column?: number;
  container?: string;
  signature?: string;
  parameters?: Array<{
    name: string;
    type?: string;
    optional?: boolean;
    rest?: boolean;
    default?: string;
  }>;
  returnType?: string;
  snippet?: string;
  score: number;
  matches: number[];
}
```

Supported symbol kinds are `class`, `constant`, `enum`, `enum-member`, `export`, `function`, `import`, `interface`, `method`, `property`, `type`, and `variable`.

## Development

```bash
bun install
bun run dev       # Run the CLI
bun run start     # Alias for dev
bun run lint      # Lint with oxlint
bun run format    # Format with oxfmt
bun run typecheck # Type check with tsgo
```

## Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Parser**: [Oxc Parser](https://oxc.rs)
- **CLI**: [Sade](https://github.com/lukeed/sade)
- **Linting**: [oxlint](https://oxc.rs)
- **Formatting**: [oxfmt](https://oxc.rs)

## License

MIT
