/**
 * Codex CLI vision provider.
 * Shells out to the OpenAI `codex` command for vision analysis.
 *
 * Uses a colocated config.toml (via CODEX_HOME env var) to disable MCPs
 * and web search for faster execution.
 *
 * Available models (from OpenAI docs / local Codex CLI usage):
 *   - gpt-5.4          : Current flagship model for complex reasoning and coding
 *   - gpt-5.2-codex    : Coding-optimized model for long-horizon agentic tasks
 *   - gpt-5.2          : Previous frontier model with reasoning
 *   - gpt-5.1-codex-max: Flagship for deep and fast reasoning
 *   - gpt-5.1-codex-mini: Cheaper, faster, less capable
 *
 * Reasoning levels: low, medium, high, xhigh (varies by model)
 * Set via: CODEX_REASONING env var or -c model_reasoning_effort=<level>
 *
 * LLM: Before modifying Codex CLI integration, fetch official docs:
 * - https://developers.openai.com/codex/models/ (available models, capabilities)
 * - https://developers.openai.com/codex/cli/reference/ (CLI flags and options)
 * - https://developers.openai.com/codex/config-reference/ (config.toml format)
 */

import type { CliProviderConfig } from "../shared/cli-factory.js";
import { CLI_DEFAULT_TIMEOUT_MS, createCliProviderLayer } from "../shared/cli-factory.js";
import { registerProvider } from "../shared/registry.js";

/** Directory containing this file and the colocated config.toml */
const __dirname = import.meta.dirname;

const config: CliProviderConfig = {
  name: "codex-cli",
  displayName: "Codex CLI",
  command: "codex",
  timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
  knownModels: ["gpt-5.4", "gpt-5.2", "gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"],

  buildEnv: () => ({
    CODEX_HOME: __dirname, // Points to vex/providers/codex-cli/ with config.toml
  }),

  buildArgs: (model, prompt, imagePaths, options) => {
    const args: string[] = ["exec", prompt, ...imagePaths.flatMap((img) => ["--image", img])];
    if (model.length > 0) {
      args.push("--model", model);
    }
    if (options?.reasoning !== undefined && options.reasoning.length > 0) {
      args.push("-c", `model_reasoning_effort=${options.reasoning}`);
    }
    // MCP disabling is now handled by config.toml via CODEX_HOME
    return args;
  },
};

export const CodexCliProviderLayer = createCliProviderLayer(config);

registerProvider("codex-cli", () => CodexCliProviderLayer, {
  displayName: config.displayName,
  type: "cli",
  command: config.command,
  installHint: "npm install -g @openai/codex",
  knownModels: config.knownModels,
});
