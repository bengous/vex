/**
 * Codex CLI vision provider.
 * Shells out to the OpenAI `codex` command for vision analysis.
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
 * @see https://developers.openai.com/codex/models/
 */

import { CLI_DEFAULT_TIMEOUT_MS, type CliProviderConfig, createCliProviderLayer } from './cli-factory.js';
import { registerProvider } from './registry.js';

/**
 * MCP servers commonly configured that are not needed for vision analysis.
 * Only includes servers that typically use stdio transport.
 * Servers not in the user's config will be silently ignored.
 */
const MCPS_TO_DISABLE = ['context7', 'mcp_docker', 'next-devtools', 'bun'] as const;

const config: CliProviderConfig = {
  name: 'codex-cli',
  displayName: 'Codex CLI',
  command: 'codex',
  timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
  knownModels: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],
  buildArgs: (model, prompt, imagePaths, options) => {
    const args: string[] = ['exec', prompt, ...imagePaths.flatMap((img) => ['--image', img])];
    if (model) {
      args.push('--model', model);
    }
    if (options?.reasoning) {
      args.push('-c', `model_reasoning_effort=${options.reasoning}`);
    }
    // Disable MCPs for faster startup (vision analysis doesn't need them)
    for (const mcp of MCPS_TO_DISABLE) {
      args.push('-c', `mcp_servers.${mcp}.enabled=false`);
    }
    return args;
  },
};

export const CodexCliProviderLayer = createCliProviderLayer(config);

registerProvider('codex-cli', CodexCliProviderLayer, {
  displayName: config.displayName,
  type: 'cli',
  command: config.command,
  knownModels: config.knownModels,
});
