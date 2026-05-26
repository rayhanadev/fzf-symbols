import { parseSync, visitorKeys } from "oxc-parser";

import type {
  ExtractedName,
  ExtractSymbolsOptions,
  SymbolKind,
  SymbolParameter,
  SymbolRecord,
} from "./types.ts";

type AstNode = {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
};

interface WalkFrame {
  node: AstNode;
  parent?: AstNode;
  container?: string;
}

interface LineColumn {
  line: number;
  column: number;
}

interface SourceLine {
  line: number;
  start: number;
  end: number;
  text: string;
}

interface CollectContext {
  file: string;
  source: string;
  lineStarts: readonly number[];
  allowedKinds?: Set<SymbolKind>;
  symbols: SymbolRecord[];
}

type SymbolMetadata = Pick<
  SymbolRecord,
  | "declarationEnd"
  | "declarationStart"
  | "commentEnd"
  | "commentStart"
  | "comments"
  | "parameters"
  | "returnType"
  | "signature"
  | "signatureEnd"
  | "signatureStart"
  | "snippet"
>;

interface AddPropertyNameInput {
  value: unknown;
  kind: SymbolKind;
  fallbackNode: AstNode;
  container?: string;
  metadata?: SymbolMetadata;
}

interface AddSymbolInput {
  name: string;
  kind: SymbolKind;
  location: Pick<AstNode, "start" | "end">;
  container?: string;
  metadata?: SymbolMetadata;
}

const CONTAINER_DECLARATION_KINDS: Partial<Record<string, SymbolKind>> = {
  ClassDeclaration: "class",
  ClassExpression: "class",
  FunctionDeclaration: "function",
  FunctionExpression: "function",
  TSDeclareFunction: "function",
  TSEnumDeclaration: "enum",
  TSInterfaceDeclaration: "interface",
  TSTypeAliasDeclaration: "type",
};

const MEMBER_KINDS: Partial<Record<string, SymbolKind>> = {
  AccessorProperty: "property",
  MethodDefinition: "method",
  PropertyDefinition: "property",
  TSMethodSignature: "method",
  TSPropertySignature: "property",
};

export function extractSymbolsFromSource(
  filename: string,
  source: string,
  options: ExtractSymbolsOptions = {},
): SymbolRecord[] {
  const allowedKinds = options.symbolKinds ? new Set(options.symbolKinds) : undefined;
  const lineStarts = createLineStarts(source);
  const symbols: SymbolRecord[] = [];

  let program: AstNode;

  try {
    const result = parseSync(filename, source, {
      sourceType: "unambiguous",
      showSemanticErrors: false,
    });

    if (result.errors.length > 0) {
      options.onError?.({
        kind: "parse",
        file: filename,
        message: result.errors.map((error) => error.message).join("\n"),
      });
    }

    program = result.program as unknown as AstNode;
  } catch (cause) {
    options.onError?.({
      kind: "parse",
      file: filename,
      message: cause instanceof Error ? cause.message : "Failed to parse source",
      cause,
    });

    return [];
  }

  try {
    walkAst(program, (node, parent, container) => {
      const nextContainer = collectSymbol(node, parent, container, {
        file: filename,
        source,
        lineStarts,
        allowedKinds,
        symbols,
      });

      return nextContainer ?? container;
    });
  } catch (cause) {
    options.onError?.({
      kind: "walk",
      file: filename,
      message: cause instanceof Error ? cause.message : "Failed to walk AST",
      cause,
    });
  }

  return symbols;
}

function collectSymbol(
  node: AstNode,
  parent: AstNode | undefined,
  container: string | undefined,
  context: CollectContext,
): string | undefined {
  const declarationKind = CONTAINER_DECLARATION_KINDS[node.type];

  if (declarationKind) {
    return collectContainerDeclaration(node, parent, container, declarationKind, context);
  }

  const memberKind = MEMBER_KINDS[node.type];

  if (memberKind) {
    addPropertyName(
      {
        value: node.key,
        kind: memberKind,
        fallbackNode: node,
        container,
        metadata: createSymbolMetadata(node, context),
      },
      context,
    );
    return undefined;
  }

  switch (node.type) {
    case "VariableDeclarator":
      addVariableDeclarator(node, parent, container, context);
      return undefined;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      addNamedDeclaration(node.local, "import", container, context);
      return undefined;
    case "ExportSpecifier":
      addNamedDeclaration(node.exported, "export", container, context);
      return undefined;
    case "ExportDefaultDeclaration":
      addSymbol(
        {
          name: "default",
          kind: "export",
          location: node,
          container,
          metadata: createSymbolMetadata(node, context),
        },
        context,
      );
      return undefined;
    case "ExportAllDeclaration":
      addNamedDeclaration(node.exported, "export", container, context);
      return undefined;
    case "Property":
      addObjectProperty(node, parent, container, context);
      return undefined;
    case "TSEnumMember":
      addPropertyName(
        {
          value: node.id,
          kind: "enum-member",
          fallbackNode: node,
          container,
          metadata: createSymbolMetadata(node, context),
        },
        context,
      );
      return undefined;
    default:
      return undefined;
  }
}

function collectContainerDeclaration(
  node: AstNode,
  parent: AstNode | undefined,
  container: string | undefined,
  kind: SymbolKind,
  context: CollectContext,
): string | undefined {
  if (
    (node.type === "ClassExpression" || node.type === "FunctionExpression") &&
    parent?.type === "VariableDeclarator"
  ) {
    return undefined;
  }

  return addNamedDeclaration(node.id, kind, container, context, node);
}

function addObjectProperty(
  node: AstNode,
  parent: AstNode | undefined,
  container: string | undefined,
  context: CollectContext,
): void {
  if (parent?.type !== "ObjectExpression") {
    return;
  }

  addPropertyName(
    {
      value: node.key,
      kind: node.method ? "method" : "property",
      fallbackNode: node,
      container,
      metadata: createSymbolMetadata(node, context),
    },
    context,
  );
}

function addVariableDeclarator(
  node: AstNode,
  parent: AstNode | undefined,
  container: string | undefined,
  context: CollectContext,
): void {
  const names = collectBindingNames(node.id);
  const init = asNode(node.init);
  const parentKind = typeof parent?.kind === "string" ? parent.kind : undefined;
  const kind: SymbolKind =
    init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression"
      ? "function"
      : parentKind === "const"
        ? "constant"
        : "variable";

  for (const name of names) {
    addSymbol(
      {
        name: name.name,
        kind,
        location: name,
        container,
        metadata: createSymbolMetadata(node, context),
      },
      context,
    );
  }
}

function addNamedDeclaration(
  value: unknown,
  kind: SymbolKind,
  container: string | undefined,
  context: CollectContext,
  node?: AstNode,
): string | undefined {
  const name = getNodeName(value);

  if (!name) {
    return undefined;
  }

  addSymbol(
    {
      name: name.name,
      kind,
      location: name,
      container,
      metadata: createSymbolMetadata(node, context),
    },
    context,
  );
  return kind === "import" || kind === "export" ? undefined : name.name;
}

function addPropertyName(input: AddPropertyNameInput, context: CollectContext): void {
  const name = getNodeName(input.value);

  if (!name) {
    return;
  }

  addSymbol(
    {
      name: name.name,
      kind: input.kind,
      location: name.start === 0 && name.end === 0 ? input.fallbackNode : name,
      container: input.container,
      metadata: input.metadata ?? createSymbolMetadata(input.fallbackNode, context),
    },
    context,
  );
}

function addSymbol(input: AddSymbolInput, context: CollectContext): void {
  const { kind, location, name } = input;

  if (!isUsefulName(name) || (context.allowedKinds && !context.allowedKinds.has(kind))) {
    return;
  }

  const start = location.start ?? 0;
  const end = location.end ?? start + name.length;
  const position = offsetToLineColumn(context.lineStarts, start);

  context.symbols.push({
    name,
    kind,
    file: context.file,
    start,
    end,
    line: position.line,
    column: position.column,
    container: input.container,
    ...input.metadata,
  });
}

function createSymbolMetadata(node: AstNode | undefined, context: CollectContext): SymbolMetadata {
  if (!node) {
    return {};
  }

  const signatureEnd = findSignatureEnd(node, context.source);

  return {
    ...createAdjacentCommentMetadata(node, context),
    declarationStart: node.start,
    declarationEnd: node.end,
    signature: createSignature(node, context.source, signatureEnd),
    signatureStart: node.start,
    signatureEnd,
    parameters: createParameters(node, context.source),
    returnType: createReturnType(node, context.source),
    snippet: createSnippet(node, context),
  };
}

function createAdjacentCommentMetadata(
  node: AstNode,
  context: CollectContext,
): Pick<SymbolRecord, "commentEnd" | "commentStart" | "comments"> {
  const start = node.start ?? 0;
  const declarationLine = offsetToLineColumn(context.lineStarts, start).line;
  const inlineComment = getInlineLeadingBlockComment(context, declarationLine, start);
  const leadingComments = collectLeadingCommentLines(context, declarationLine);
  const commentLines = inlineComment ? [...leadingComments, inlineComment] : leadingComments;

  if (commentLines.length === 0) {
    return {};
  }

  return {
    comments: commentLines.map((line) => line.text.trim()),
    commentStart: commentLines[0]?.start,
    commentEnd: commentLines.at(-1)?.end,
  };
}

function collectLeadingCommentLines(
  context: CollectContext,
  declarationLine: number,
): SourceLine[] {
  return collectLeadingCommentLinesBefore(context, declarationLine - 1);
}

function collectLeadingCommentLinesBefore(context: CollectContext, line: number): SourceLine[] {
  if (line < 1) {
    return [];
  }

  const sourceLine = getSourceLine(context, line);
  const text = sourceLine.text.trim();

  if (!text) {
    return [];
  }

  if (isLineComment(text)) {
    return [...collectLeadingCommentLinesBefore(context, line - 1), sourceLine];
  }

  if (!endsBlockComment(text)) {
    return [];
  }

  const blockComment = collectBlockCommentLines(context, line);

  if (blockComment.length === 0) {
    return [];
  }

  return [
    ...collectLeadingCommentLinesBefore(context, (blockComment[0]?.line ?? line) - 1),
    ...blockComment,
  ];
}

function collectBlockCommentLines(context: CollectContext, endLine: number): SourceLine[] {
  const commentLines: SourceLine[] = [];

  for (let line = endLine; line >= 1; line -= 1) {
    const sourceLine = getSourceLine(context, line);
    commentLines.unshift(sourceLine);

    if (startsBlockComment(sourceLine.text.trim())) {
      return commentLines;
    }
  }

  return [];
}

function getInlineLeadingBlockComment(
  context: CollectContext,
  declarationLine: number,
  declarationStart: number,
): SourceLine | undefined {
  const sourceLine = getSourceLine(context, declarationLine);
  const commentEnd = declarationStart - sourceLine.start;
  const prefix = sourceLine.text.slice(0, Math.max(0, commentEnd));
  const commentStart = prefix.indexOf("/*");

  if (commentStart === -1) {
    return undefined;
  }

  const comment = prefix.slice(commentStart).trim();

  if (!startsBlockComment(comment) || !endsBlockComment(comment)) {
    return undefined;
  }

  return {
    line: sourceLine.line,
    start: sourceLine.start + commentStart,
    end: sourceLine.start + prefix.length,
    text: comment,
  };
}

function createSignature(
  node: AstNode,
  source: string,
  signatureEnd = findSignatureEnd(node, source),
): string | undefined {
  const start = node.start ?? 0;
  const signature = normalizeSnippet(source.slice(start, signatureEnd));

  return signature.length > 0 ? signature : undefined;
}

function findSignatureEnd(node: AstNode, source: string): number {
  const functionNode = getFunctionLikeNode(node);
  const body = asNode(functionNode?.body);
  const ownBody = asNode(node.body);
  const lineEnd = source.indexOf("\n", node.start ?? 0);
  const fallbackEnd = lineEnd === -1 ? (node.end ?? source.length) : lineEnd;
  const bodyStart = body?.start ?? ownBody?.start;

  if (bodyStart && bodyStart > (node.start ?? 0)) {
    return bodyStart;
  }

  return Math.min(node.end ?? fallbackEnd, fallbackEnd);
}

function createParameters(node: AstNode, source: string): SymbolParameter[] | undefined {
  const functionNode = getFunctionLikeNode(node);
  const params = Array.isArray(functionNode?.params) ? functionNode.params : undefined;

  if (!params || params.length === 0) {
    return undefined;
  }

  return params.flatMap((param) => {
    const parameter = asNode(param);

    if (!parameter) {
      return [];
    }

    return [createParameter(parameter, source)];
  });
}

function createParameter(node: AstNode, source: string): SymbolParameter {
  const target = getParameterTarget(node);
  const name = collectBindingNames(target)[0]?.name ?? normalizeSnippet(sliceNode(target, source));
  const text = sliceNode(node, source);

  return {
    name,
    type: createParameterType(target, source),
    optional: Boolean(target.optional) || text.includes("?:"),
    rest: node.type === "RestElement" || text.trimStart().startsWith("..."),
    default: createParameterDefault(node, source),
  };
}

function createParameterType(node: AstNode, source: string): string | undefined {
  const typeAnnotation = asNode(node.typeAnnotation);

  if (typeAnnotation) {
    return normalizeSnippet(sliceNode(typeAnnotation, source).replace(/^:\s*/, ""));
  }

  const nested = asNode(node.parameter) ?? asNode(node.left) ?? asNode(node.argument);

  if (nested) {
    return createParameterType(nested, source);
  }

  return undefined;
}

function createParameterDefault(node: AstNode, source: string): string | undefined {
  if (node.type === "AssignmentPattern") {
    const right = asNode(node.right);
    return right ? normalizeSnippet(sliceNode(right, source)) : undefined;
  }

  const nested = asNode(node.parameter) ?? asNode(node.left) ?? asNode(node.argument);

  if (nested) {
    return createParameterDefault(nested, source);
  }

  return undefined;
}

function createReturnType(node: AstNode, source: string): string | undefined {
  const functionNode = getFunctionLikeNode(node);
  const returnType = asNode(functionNode?.returnType);

  if (!returnType) {
    return undefined;
  }

  return normalizeSnippet(sliceNode(returnType, source).replace(/^:\s*/, ""));
}

function createSnippet(node: AstNode, context: CollectContext): string | undefined {
  const start = node.start ?? 0;
  const line = offsetToLineColumn(context.lineStarts, start).line;
  const lineStart = context.lineStarts[line - 1] ?? 0;
  const nextLineStart = context.lineStarts[line];
  const lineEnd = nextLineStart ? nextLineStart - 1 : context.source.length;
  const snippet = normalizeSnippet(context.source.slice(lineStart, lineEnd));

  return snippet.length > 0 ? snippet : undefined;
}

function getFunctionLikeNode(node: AstNode): AstNode | undefined {
  if (Array.isArray(node.params)) {
    return node;
  }

  const value = asNode(node.value);

  if (value && Array.isArray(value.params)) {
    return value;
  }

  const init = asNode(node.init);

  if (init && Array.isArray(init.params)) {
    return init;
  }

  return undefined;
}

function getParameterTarget(node: AstNode): AstNode {
  return asNode(node.parameter) ?? asNode(node.left) ?? asNode(node.argument) ?? node;
}

function sliceNode(node: AstNode, source: string): string {
  return source.slice(node.start ?? 0, node.end ?? node.start ?? 0);
}

function normalizeSnippet(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getSourceLine(context: CollectContext, line: number): SourceLine {
  const start = context.lineStarts[line - 1] ?? 0;
  const nextLineStart = context.lineStarts[line];
  let end = nextLineStart ? nextLineStart - 1 : context.source.length;

  if (context.source.charCodeAt(end - 1) === 13) {
    end -= 1;
  }

  return {
    line,
    start,
    end,
    text: context.source.slice(start, end),
  };
}

function isLineComment(text: string): boolean {
  return text.startsWith("//");
}

function startsBlockComment(text: string): boolean {
  return text.startsWith("/*");
}

function endsBlockComment(text: string): boolean {
  return text.endsWith("*/");
}

function walkAst(
  root: AstNode,
  visit: (
    node: AstNode,
    parent: AstNode | undefined,
    container: string | undefined,
  ) => string | undefined,
): void {
  const stack: WalkFrame[] = [{ node: root }];

  while (stack.length > 0) {
    const frame = stack.pop();

    if (!frame) {
      continue;
    }

    const container = visit(frame.node, frame.parent, frame.container);
    const keys = visitorKeys[frame.node.type] ?? [];

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const child = frame.node[keys[index] ?? ""];

      if (Array.isArray(child)) {
        for (let childIndex = child.length - 1; childIndex >= 0; childIndex -= 1) {
          const item = asNode(child[childIndex]);

          if (item) {
            stack.push({ node: item, parent: frame.node, container });
          }
        }

        continue;
      }

      const childNode = asNode(child);

      if (childNode) {
        stack.push({ node: childNode, parent: frame.node, container });
      }
    }
  }
}

function collectBindingNames(value: unknown): ExtractedName[] {
  const node = asNode(value);

  if (!node) {
    return [];
  }

  switch (node.type) {
    case "Identifier":
      return getNodeName(node) ? [getNodeName(node) as ExtractedName] : [];
    case "AssignmentPattern":
      return collectBindingNames(node.left);
    case "RestElement":
      return collectBindingNames(node.argument);
    case "ArrayPattern":
      return collectArrayBindingNames(node.elements);
    case "ObjectPattern":
      return collectObjectBindingNames(node.properties);
    case "TSParameterProperty":
      return collectBindingNames(node.parameter);
    default:
      return [];
  }
}

function collectArrayBindingNames(value: unknown): ExtractedName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => collectBindingNames(item));
}

function collectObjectBindingNames(value: unknown): ExtractedName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const node = asNode(item);

    if (!node) {
      return [];
    }

    if (node.type === "RestElement") {
      return collectBindingNames(node.argument);
    }

    if (node.type === "Property") {
      return collectBindingNames(node.value);
    }

    return [];
  });
}

function getNodeName(value: unknown): ExtractedName | undefined {
  const node = asNode(value);

  if (!node) {
    return undefined;
  }

  if (
    node.type === "Identifier" ||
    node.type === "IdentifierName" ||
    node.type === "JSXIdentifier"
  ) {
    return typeof node.name === "string"
      ? { name: node.name, start: node.start ?? 0, end: node.end ?? node.start ?? 0 }
      : undefined;
  }

  if (node.type === "PrivateIdentifier" && typeof node.name === "string") {
    return { name: `#${node.name}`, start: node.start ?? 0, end: node.end ?? node.start ?? 0 };
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return { name: node.value, start: node.start ?? 0, end: node.end ?? node.start ?? 0 };
  }

  if (node.type === "Literal" && typeof node.value === "number") {
    return { name: String(node.value), start: node.start ?? 0, end: node.end ?? node.start ?? 0 };
  }

  return undefined;
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

function offsetToLineColumn(lineStarts: readonly number[], offset: number): LineColumn {
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

  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;

  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
  };
}

function asNode(value: unknown): AstNode | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<AstNode>;
  return typeof candidate.type === "string" ? (candidate as AstNode) : undefined;
}

function isUsefulName(name: string): boolean {
  return name.length > 0;
}
