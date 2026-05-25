# fzfsym

Fast fuzzy symbol search for JavaScript and TypeScript codebases, powered by [`oxc-parser`](https://oxc.rs).

`fzfsym` scans source files, extracts declarations, fuzzy-ranks matching symbols, and returns output that is readable by humans and useful to AI tools.

## Install

```bash
bun add fzfsym
```

Run the CLI without installing it into a project:

```bash
bunx fzfsym Button
```

## CLI

Search for symbols in a file or directory:

```bash
fzfsym Button src
fzfsym btn test/fixtures/sample.tsx --kind function,class --limit 10
fzfsym props src --kind interface
fzfsym button src --format json
```

Options:

- `--limit`, `-l`: maximum results to print, default `50`.
- `--format`, `-f`: `text` or `json`, default `text`.
- `--kind`, `-k`: comma-separated symbol kinds to include. By default the CLI omits `constant` and `variable` matches to keep output focused on named API surfaces.
- `--verbose`: print parser and file diagnostics.

Text output is grouped by file and rendered as a compact code outline:

````text
src/button.tsx
```tsx
  12 | export function Button(props: ButtonProps) {
  13 |   ...
  16 | }

  20 | export interface ButtonProps {
  21 |   label: string;
  22 |   onClick(): void;
  23 | }
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
import { extractSymbolsFromSource, scanSymbols, searchSymbols } from "fzfsym";

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

Search results include the symbol identity, location, declaration span, signature span, parsed parameters when available, a source snippet, score, and matched character positions.

```ts
interface SymbolSearchResult {
  name: string;
  kind: SymbolKind;
  file: string;
  start: number;
  end: number;
  declarationStart?: number;
  declarationEnd?: number;
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
