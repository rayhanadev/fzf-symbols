#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { SymbolParseError, searchSymbols } from "./index.ts";

import type { SearchSymbolsOptions, SymbolKind, SymbolSearchResult } from "./index.ts";

const require = createRequire(import.meta.url);
const sade = require("sade") as typeof import("sade");
const packageJson = require("../package.json") as { version: string };

const VERSION = packageJson.version;
const MAX_COMMENT_LINES = 10;
const MAX_INTERFACE_PROPERTIES = 15;
const DEFAULT_SYMBOL_KINDS: SymbolKind[] = [
  "class",
  "enum",
  "function",
  "interface",
  "method",
  "property",
  "type",
];
const SYMBOL_KINDS = new Set<SymbolKind>([
  "class",
  "constant",
  "enum",
  "enum-member",
  "export",
  "function",
  "import",
  "interface",
  "method",
  "property",
  "type",
  "variable",
]);
const DEFAULT_KIND_HELP = DEFAULT_SYMBOL_KINDS.join(",");
const ALL_KIND_HELP = Array.from(SYMBOL_KINDS).join(",");

interface CliOptions {
  limit?: number | string;
  format?: string;
  kind?: string;
}

interface CliJsonOutput {
  query: string;
  root: string;
  count: number;
  results: CliJsonResult[];
}

interface CliJsonResult {
  name: string;
  kind: SymbolKind;
  location: {
    file: string;
    line: number;
    column: number;
  };
  signature?: string;
  declarationStart?: number;
  declarationEnd?: number;
  commentStart?: number;
  commentEnd?: number;
  comments?: string[];
  signatureStart?: number;
  signatureEnd?: number;
  parameters?: SymbolSearchResult["parameters"];
  returnType?: string;
  container?: string;
  snippet?: string;
  score: number;
  matches: number[];
}

interface FileOutline {
  file: string;
  language: string;
  lines: string[];
}

interface SourceLine {
  line: number;
  text: string;
}

interface EnclosingBlock {
  open: SourceLine;
  close?: SourceLine;
}

export async function runCli(argv = process.argv): Promise<void> {
  sade("truffler <query> [root]", true)
    .version(VERSION)
    .describe("Find code symbols by fuzzy name matching.")
    .option("-l, --limit", "Maximum number of results to print.", 50)
    .option("-f, --format", "Output format. Options: text,json.", "text")
    .option(
      "-k, --kind",
      `Comma-separated symbol kinds. Default: ${DEFAULT_KIND_HELP}. Options: ${ALL_KIND_HELP}.`,
    )
    .example("Button src")
    .example("btn --kind function,class --limit 20 --format json")
    .action(async (query: string, root: string | undefined, options: CliOptions) => {
      try {
        await runSearch(query, root, options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    })
    .parse(argv);
}

async function runSearch(
  query: string,
  root: string | undefined,
  options: CliOptions,
): Promise<void> {
  const format = options.format ?? "text";

  if (format !== "text" && format !== "json") {
    throw new Error(`Unsupported format "${format}". Use "text" or "json".`);
  }

  const searchOptions: SearchSymbolsOptions = {
    root: root ?? ".",
    cwd: process.cwd(),
    limit: parseLimit(options.limit),
    symbolKinds: parseSymbolKinds(options.kind),
    ignoreParseErrors: true,
    onParseError: warnParseError,
  };

  const results = await searchSymbols(query, searchOptions);

  if (format === "json") {
    console.log(
      JSON.stringify(createJsonOutput(query, searchOptions.root ?? ".", results), null, 2),
    );
    return;
  }

  await printTextResults(results);
}

async function printTextResults(results: readonly SymbolSearchResult[]): Promise<void> {
  const outlines = await createFileOutlines(results);

  for (const [index, outline] of outlines.entries()) {
    if (index > 0) {
      console.log("");
    }

    console.log(formatFile(outline.file));
    console.log(`\`\`\`${outline.language}`);
    console.log(outline.lines.join("\n"));
    console.log("```");
  }
}

function createJsonOutput(
  query: string,
  root: string,
  results: readonly SymbolSearchResult[],
): CliJsonOutput {
  return {
    query,
    root,
    count: results.length,
    results: results.map((result) => ({
      name: result.name,
      kind: result.kind,
      location: {
        file: formatFile(result.file),
        line: result.line ?? 1,
        column: result.column ?? 1,
      },
      signature: result.signature,
      declarationStart: result.declarationStart,
      declarationEnd: result.declarationEnd,
      commentStart: result.commentStart,
      commentEnd: result.commentEnd,
      comments: truncateComments(result.comments),
      signatureStart: result.signatureStart,
      signatureEnd: result.signatureEnd,
      parameters: result.parameters,
      returnType: result.returnType,
      container: result.container,
      snippet: result.snippet,
      score: Number(result.score.toFixed(4)),
      matches: result.matches,
    })),
  };
}

function formatFile(file: string): string {
  const relativePath = path.relative(process.cwd(), file);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : file;
}

function warnParseError(error: SymbolParseError): void {
  console.error(`Warning: skipped ${formatFile(error.file)}: ${parseErrorMessage(error)}`);
}

function parseErrorMessage(error: SymbolParseError): string {
  const prefix = `${error.file}: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

async function createFileOutlines(results: readonly SymbolSearchResult[]): Promise<FileOutline[]> {
  const groupedResults = groupResultsByFile(results);
  const outlines: FileOutline[] = [];

  for (const [file, fileResults] of groupedResults) {
    const source = await readFile(file, "utf8");
    const lines = source.split(/\r?\n/);
    const lineStarts = createLineStarts(source);

    outlines.push({
      file,
      language: getMarkdownLanguage(file),
      lines: fileResults.flatMap((result, index) => [
        ...(index > 0 ? [""] : []),
        ...createOutlineLines(result, lines, lineStarts),
      ]),
    });
  }

  return outlines;
}

function groupResultsByFile(
  results: readonly SymbolSearchResult[],
): Map<string, SymbolSearchResult[]> {
  const groupedResults = new Map<string, SymbolSearchResult[]>();

  for (const result of results) {
    const group = groupedResults.get(result.file);

    if (group) {
      group.push(result);
    } else {
      groupedResults.set(result.file, [result]);
    }
  }

  for (const group of groupedResults.values()) {
    group.sort((left, right) => (left.line ?? 0) - (right.line ?? 0));
  }

  return groupedResults;
}

function createOutlineLines(
  result: SymbolSearchResult,
  lines: readonly string[],
  lineStarts: readonly number[],
): string[] {
  const declarationStartOffset = result.declarationStart ?? result.start;
  const startOffset = result.commentStart ?? declarationStartOffset;
  const endOffset = result.declarationEnd ?? result.end;
  const startLine = offsetToLine(lineStarts, startOffset);
  const declarationStartLine = offsetToLine(lineStarts, declarationStartOffset);
  const signatureEndLine = offsetToLine(
    lineStarts,
    Math.max((result.signatureEnd ?? declarationStartOffset) - 1, declarationStartOffset),
  );
  const endLine = Math.max(
    declarationStartLine,
    offsetToLine(lineStarts, Math.max(endOffset - 1, declarationStartOffset)),
  );
  const signatureLines = createSignatureLines(
    startLine,
    declarationStartLine,
    signatureEndLine,
    lines,
  );

  if (endLine <= declarationStartLine) {
    return (
      createMemberOutlineIfNeeded(result, signatureLines, startLine, endLine, lines) ??
      signatureLines
    );
  }

  const endText = findLastNonEmptyLine(lines, startLine, endLine);

  if (!endText) {
    return (
      createMemberOutlineIfNeeded(result, signatureLines, startLine, endLine, lines) ??
      signatureLines
    );
  }

  if (endText.line <= signatureEndLine) {
    return (
      createMemberOutlineIfNeeded(result, signatureLines, startLine, endText.line, lines) ??
      signatureLines
    );
  }

  const memberOutline = createMemberOutlineIfNeeded(
    result,
    createDeclarationOutlineLines(signatureLines, signatureEndLine, endText, lines),
    startLine,
    endText.line,
    lines,
  );

  if (memberOutline) {
    return memberOutline;
  }

  if (result.kind === "interface") {
    return createInterfaceOutlineLines(signatureLines, signatureEndLine, endText, lines);
  }

  return createDeclarationOutlineLines(signatureLines, signatureEndLine, endText, lines);
}

function createDeclarationOutlineLines(
  signatureLines: readonly string[],
  signatureEndLine: number,
  endText: SourceLine,
  lines: readonly string[],
): string[] {
  return [
    ...signatureLines,
    formatCodeLine(
      signatureEndLine + 1,
      `${leadingWhitespace(lines[signatureEndLine - 1] ?? "")}  ...`,
    ),
    formatCodeLine(endText.line, endText.text),
  ];
}

function createMemberOutlineIfNeeded(
  result: SymbolSearchResult,
  memberLines: readonly string[],
  memberStartLine: number,
  memberEndLine: number,
  lines: readonly string[],
): string[] | undefined {
  if (result.kind !== "method" && result.kind !== "property") {
    return undefined;
  }

  const enclosingBlock = findEnclosingBlock(lines, memberStartLine);

  if (!enclosingBlock) {
    return undefined;
  }

  const bodyIndent = `${leadingWhitespace(enclosingBlock.open.text)}  `;
  const output = [formatCodeLine(enclosingBlock.open.line, enclosingBlock.open.text)];

  if (enclosingBlock.open.line + 1 < memberStartLine) {
    output.push(formatSyntheticLine(`${bodyIndent}...`));
  }

  output.push(...memberLines);

  if (enclosingBlock.close && memberEndLine + 1 < enclosingBlock.close.line) {
    output.push(formatSyntheticLine(`${bodyIndent}...`));
  }

  if (enclosingBlock.close && enclosingBlock.close.line > memberEndLine) {
    output.push(formatCodeLine(enclosingBlock.close.line, enclosingBlock.close.text));
  }

  return output;
}

function createInterfaceOutlineLines(
  signatureLines: readonly string[],
  signatureEndLine: number,
  endText: { line: number; text: string },
  lines: readonly string[],
): string[] {
  const propertyLines = collectInterfacePropertyLines(
    lines,
    signatureEndLine + 1,
    endText.line - 1,
  );

  if (propertyLines.length === 0) {
    return [...signatureLines, formatCodeLine(endText.line, endText.text)];
  }

  const visibleProperties = propertyLines.slice(0, MAX_INTERFACE_PROPERTIES);
  const hiddenCount = propertyLines.length - visibleProperties.length;
  const summaryIndent = leadingWhitespace(visibleProperties[0]?.text ?? "  ");

  return [
    ...signatureLines,
    ...visibleProperties.map((property) => formatCodeLine(property.line, property.text)),
    ...(hiddenCount > 0
      ? [formatSyntheticLine(`${summaryIndent}(...and ${hiddenCount} more properties)`)]
      : []),
    formatCodeLine(endText.line, endText.text),
  ];
}

function findEnclosingBlock(
  lines: readonly string[],
  memberStartLine: number,
): EnclosingBlock | undefined {
  const stack: SourceLine[] = [];

  for (let line = 1; line < memberStartLine; line += 1) {
    updateBraceStack(stack, line, lines[line - 1] ?? "");
  }

  const open = stack.at(-1);

  if (!open) {
    return undefined;
  }

  return {
    open,
    close: findClosingBraceLine(lines, open.line),
  };
}

function updateBraceStack(stack: SourceLine[], line: number, text: string): void {
  for (const character of text) {
    if (character === "{") {
      stack.push({ line, text });
      continue;
    }

    if (character === "}") {
      stack.pop();
    }
  }
}

function findClosingBraceLine(lines: readonly string[], openLine: number): SourceLine | undefined {
  let depth = 0;

  for (let line = openLine; line <= lines.length; line += 1) {
    const text = lines[line - 1] ?? "";

    for (const character of text) {
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;

        if (depth === 0) {
          return { line, text };
        }
      }
    }
  }

  return undefined;
}

function collectInterfacePropertyLines(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): Array<{ line: number; text: string }> {
  const properties: Array<{ line: number; text: string }> = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const text = lines[line - 1];

    if (text?.trim()) {
      properties.push({ line, text });
    }
  }

  return properties;
}

function createSignatureLines(
  startLine: number,
  declarationStartLine: number,
  signatureEndLine: number,
  lines: readonly string[],
): string[] {
  const output =
    startLine < declarationStartLine
      ? createCommentLines(startLine, declarationStartLine - 1, lines)
      : [];

  for (let line = declarationStartLine; line <= signatureEndLine; line += 1) {
    output.push(formatCodeLine(line, lines[line - 1] ?? ""));
  }

  return output;
}

function createCommentLines(
  startLine: number,
  endLine: number,
  lines: readonly string[],
): string[] {
  const lineCount = endLine - startLine + 1;
  const visibleLineCount = Math.min(lineCount, MAX_COMMENT_LINES);
  const output: string[] = [];

  for (let index = 0; index < visibleLineCount; index += 1) {
    const line = startLine + index;
    output.push(formatCodeLine(line, lines[line - 1] ?? ""));
  }

  const hiddenCount = lineCount - visibleLineCount;

  if (hiddenCount > 0) {
    const lastVisibleLine = startLine + visibleLineCount - 1;
    const indent = leadingWhitespace(lines[lastVisibleLine - 1] ?? "");
    output.push(formatSyntheticLine(`${indent}(...and ${hiddenCount} more comment lines)`));
  }

  return output;
}

function truncateComments(comments: readonly string[] | undefined): string[] | undefined {
  if (!comments || comments.length <= MAX_COMMENT_LINES) {
    return comments ? [...comments] : undefined;
  }

  return [
    ...comments.slice(0, MAX_COMMENT_LINES),
    `(...and ${comments.length - MAX_COMMENT_LINES} more comment lines)`,
  ];
}

function findLastNonEmptyLine(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): { line: number; text: string } | undefined {
  for (let line = endLine; line > startLine; line -= 1) {
    const text = lines[line - 1];

    if (text?.trim()) {
      return { line, text };
    }
  }

  return undefined;
}

function formatCodeLine(line: number, text: string): string {
  return `${String(line).padStart(4, " ")} | ${truncateLine(text)}`;
}

function formatSyntheticLine(text: string): string {
  return `     | ${truncateLine(text)}`;
}

function truncateLine(text: string): string {
  const maxLength = 120;
  const normalized = text.replace(/\s+$/g, "");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function leadingWhitespace(text: string): string {
  return text.match(/^\s*/)?.[0] ?? "";
}

function getMarkdownLanguage(file: string): string {
  if (file.endsWith(".tsx")) {
    return "tsx";
  }

  if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")) {
    return "ts";
  }

  if (file.endsWith(".jsx")) {
    return "jsx";
  }

  return "js";
}

function createLineStarts(source: string): number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;

    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(0, high) + 1;
}

function parseLimit(value: number | string | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (!value) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid limit "${value}".`);
  }

  return parsed;
}

function parseSymbolKinds(value: string | undefined): SymbolKind[] | undefined {
  if (!value) {
    return DEFAULT_SYMBOL_KINDS;
  }

  return value.split(",").map((kind) => {
    const normalized = kind.trim() as SymbolKind;

    if (!SYMBOL_KINDS.has(normalized)) {
      throw new Error(`Unsupported symbol kind "${kind}". Options: ${ALL_KIND_HELP}.`);
    }

    return normalized;
  });
}

if (import.meta.main) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
