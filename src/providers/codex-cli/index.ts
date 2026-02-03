/**
 * Codex CLI vision provider.
 * Shells out to the OpenAI `codex` command for vision analysis.
 *
 * Uses a colocated config.toml (via CODEX_HOME env var) to disable MCPs
 * and web search for faster execution.
 *
 * Available models (from ~/.codex/models_cache.json):
 *   - gpt-5.2-codex    : Latest frontier agentic coding model (default)
 *   - gpt-5.2          : Latest frontier model with reasoning
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

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_DEFAULT_TIMEOUT_MS, type CliProviderConfig, createCliProviderLayer } from '../shared/cli-factory.js';
import { registerProvider } from '../shared/registry.js';

// biome-ignore lint/performance/noBarrelFile: Provider with re-exported types for cross-module use
export { CodexEnv, type CodexEnvService, makeCodexEnvResource } from './environment.js';

/** Directory containing this file and the colocated config.toml */
const __dirname = dirname(fileURLToPath(import.meta.url));

const config: CliProviderConfig = {
  name: 'codex-cli',
  displayName: 'Codex CLI',
  command: 'codex',
  timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
  knownModels: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],

  buildEnv: () => ({
    CODEX_HOME: __dirname, // Points to vex/providers/codex-cli/ with config.toml
  }),

  buildArgs: (model, prompt, imagePaths, options) => {
    const args: string[] = ['exec', prompt, ...imagePaths.flatMap((img) => ['--image', img])];
    if (model) {
      args.push('--model', model);
    }
    if (options?.reasoning) {
      args.push('-c', `model_reasoning_effort=${options.reasoning}`);
    }
    // MCP disabling is now handled by config.toml via CODEX_HOME
    return args;
  },
};

export const CodexCliProviderLayer = createCliProviderLayer(config);

registerProvider('codex-cli', () => CodexCliProviderLayer, {
  displayName: config.displayName,
  type: 'cli',
  command: config.command,
  installHint: 'npm install -g @openai/codex',
  knownModels: config.knownModels,
});
