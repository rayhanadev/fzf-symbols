import { highlightText as highlightSyntaxText } from "@speed-highlight/core/terminal";

import type { ShjLanguage } from "@speed-highlight/core/terminal";

interface HighlightContext {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  stdout?: {
    isTTY?: boolean;
  };
}

const ESCAPE = "\x1b[";
const RESET = `${ESCAPE}0m`;

const ANSI = {
  bold: `${ESCAPE}1m`,
  cyan: `${ESCAPE}36m`,
  dim: `${ESCAPE}2m`,
};

const CI_ENVIRONMENT_VARIABLES = [
  "AC_APPCIRCLE",
  "AGOLA_GIT_REF",
  "ALPIC_HOST",
  "APPVEYOR",
  "APPCENTER_BUILD_ID",
  "bamboo_planKey",
  "BITBUCKET_COMMIT",
  "BITRISE_IO",
  "BUDDY_WORKSPACE_ID",
  "BUILDER_OUTPUT",
  "BUILDKITE",
  "CF_BUILD_ID",
  "CF_PAGES",
  "CIRCLECI",
  "CIRRUS_CI",
  "CI",
  "CM_BUILD_ID",
  "CODEBUILD_BUILD_ARN",
  "CONTINUOUS_INTEGRATION",
  "DRONE",
  "DSARI",
  "EARTHLY_CI",
  "EAS_BUILD",
  "GERRIT_PROJECT",
  "GITEA_ACTIONS",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "GO_PIPELINE_LABEL",
  "HARNESS_BUILD_ID",
  "HUDSON_URL",
  "LAYERCI",
  "MAGNUM",
  "NETLIFY",
  "NEVERCODE",
  "NOW_BUILDER",
  "PROW_JOB_ID",
  "RELEASE_BUILD_ID",
  "RENDER",
  "SAILCI",
  "SCREWDRIVER",
  "SEMAPHORE",
  "STRIDER",
  "TEAMCITY_VERSION",
  "TF_BUILD",
  "TRAVIS",
  "VELA",
  "VERCEL",
  "WORKERS_CI",
  "XCODE_CLOUD",
  "XCS",
];

const CI_ENVIRONMENT_PREFIXES = [
  "AGOLA_",
  "APPVEYOR_",
  "BITBUCKET_",
  "BITRISE_",
  "BUDDY_",
  "BUILDKITE_",
  "CIRCLE_",
  "CIRRUS_",
  "CI_",
  "CODEBUILD_",
  "DRONE_",
  "GITHUB_ACTIONS_",
  "GITLAB_",
  "HARNESS_",
  "JENKINS_",
  "NETLIFY_",
  "SEMAPHORE_",
  "TEAMCITY_",
  "TRAVIS_",
  "VELA_",
  "VERCEL_",
  "WOODPECKER_",
  "XCS_",
];

const AI_AGENT_ENVIRONMENT_VARIABLES = [
  "AGENT",
  "AI_AGENT",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_IS_COWORK",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDECODE",
  "CLINE_ACTIVE",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_MODEL",
  "CURSOR_AGENT",
  "CURSOR_CLI",
  "CURSOR_SANDBOX",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "GEMINI_CLI_NO_RELAUNCH",
  "GOOSE_PROVIDER",
  "GOOSE_TERMINAL",
  "OPENCODE",
  "OPENCODE_CALLER",
  "OPENCODE_CLIENT",
  "OPENCLAW_SHELL",
  "PI_CODING_AGENT",
  "REPL_ID",
  "ROO_ACTIVE",
  "TRAE_AI_SHELL_ID",
];

const AI_AGENT_ENVIRONMENT_PREFIXES = [
  "ANTIGRAVITY_",
  "AUGMENT_",
  "CLAUDE_CODE_",
  "CODEX_",
  "COPILOT_",
  "GEMINI_CLI_",
  "OPENCODE_",
];

export function shouldHighlightTextResults(context: HighlightContext = {}): boolean {
  const argv = context.argv ?? process.argv;
  const env = context.env ?? process.env;
  const stdout = context.stdout ?? process.stdout;

  if (
    hasNoColorFlag(argv) ||
    hasColorDisabledEnv(env) ||
    hasCiEnvironment(env) ||
    hasAiAgentEnvironment(env)
  ) {
    return false;
  }

  if (hasForceColorFlag(argv) || hasColorForcedEnv(env)) {
    return true;
  }

  return !!stdout.isTTY && env.TERM !== "dumb";
}

export function highlightFilePath(file: string): string {
  return color(file, ANSI.bold, ANSI.cyan);
}

export function highlightFence(fence: string): string {
  return color(fence, ANSI.dim);
}

export async function highlightOutlineLines(
  lines: readonly string[],
  language: string,
): Promise<string[]> {
  const codeLines = lines.map((line) => parseOutlineLine(line).code);
  const highlightedCodeLines = (
    await highlightSyntaxText(codeLines.join("\n"), getSyntaxLanguage(language))
  ).split("\n");

  return lines.map((line, index) => {
    const { prefix } = parseOutlineLine(line);
    const highlightedCode = highlightedCodeLines[index] ?? "";

    return prefix ? `${color(prefix, ANSI.dim)}${highlightedCode}` : highlightedCode;
  });
}

function parseOutlineLine(line: string): { prefix?: string; code: string } {
  const prefix = line.match(/^(?: *\d+ \| | {5}\| )/)?.[0];

  if (prefix) {
    return { prefix, code: line.slice(prefix.length) };
  }

  return { code: line };
}

function getSyntaxLanguage(language: string): ShjLanguage {
  switch (language) {
    case "jsx":
    case "js":
      return "js";
    case "tsx":
    case "ts":
      return "ts";
    default:
      return "plain";
  }
}

function hasNoColorFlag(argv: readonly string[]): boolean {
  return argv.some(
    (argument) =>
      argument === "--no-color" ||
      argument === "--color=0" ||
      argument === "--color=false" ||
      argument === "--color=never",
  );
}

function hasForceColorFlag(argv: readonly string[]): boolean {
  return argv.some(
    (argument) =>
      argument === "--color" ||
      argument === "--color=1" ||
      argument === "--color=2" ||
      argument === "--color=3" ||
      argument === "--color=always" ||
      argument === "--color=true",
  );
}

function hasColorDisabledEnv(env: Record<string, string | undefined>): boolean {
  return (
    hasNonEmptyEnv(env, "NO_COLOR") ||
    isTruthyEnv(env.NODE_DISABLE_COLORS) ||
    env.FORCE_COLOR === "0" ||
    env.CLICOLOR === "0"
  );
}

function hasColorForcedEnv(env: Record<string, string | undefined>): boolean {
  return isTruthyEnv(env.FORCE_COLOR) || isTruthyEnv(env.CLICOLOR_FORCE);
}

function hasCiEnvironment(env: Record<string, string | undefined>): boolean {
  if (CI_ENVIRONMENT_VARIABLES.some((key) => isTruthyEnv(env[key]))) {
    return true;
  }

  if (env.CI_NAME === "codeship" || env.CI_NAME === "sourcehut" || env.CI === "woodpecker") {
    return true;
  }

  if (isTruthyEnv(env.JENKINS_URL) && isTruthyEnv(env.BUILD_ID)) {
    return true;
  }

  if (isTruthyEnv(env.TASK_ID) && isTruthyEnv(env.RUN_ID)) {
    return true;
  }

  return Object.keys(env).some((key) =>
    CI_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix) && isTruthyEnv(env[key])),
  );
}

function hasAiAgentEnvironment(env: Record<string, string | undefined>): boolean {
  if (AI_AGENT_ENVIRONMENT_VARIABLES.some((key) => isTruthyEnv(env[key]))) {
    return true;
  }

  if (env.CURSOR_EXTENSION_HOST_ROLE === "agent-exec") {
    return true;
  }

  if (env.TERM_PROGRAM?.toLowerCase().includes("kiro")) {
    return true;
  }

  if (env.EDITOR?.toLowerCase().includes("devin")) {
    return true;
  }

  if (/\.pi[\\/]agent/.test(env.PATH ?? "")) {
    return true;
  }

  return Object.keys(env).some((key) =>
    AI_AGENT_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix) && isTruthyEnv(env[key])),
  );
}

function hasNonEmptyEnv(env: Record<string, string | undefined>, key: string): boolean {
  return (env[key]?.length ?? 0) > 0;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized !== "0" && normalized !== "false";
}

function color(value: string, ...codes: string[]): string {
  return `${codes.join("")}${value}${RESET}`;
}
