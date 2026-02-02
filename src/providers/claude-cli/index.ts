/**
 * Claude CLI vision provider.
 * Shells out to the `claude` command for vision analysis.
 */

import { CLI_DEFAULT_TIMEOUT_MS, type CliProviderConfig, createCliProviderLayer } from '../shared/cli-factory.js';
import { registerProvider } from '../shared/registry.js';

/** Focused system prompt for image analysis */
const SYSTEM_PROMPT = `You are an image analysis assistant. Your only task is to analyze images using the Read tool and provide structured analysis.

Instructions:
1. Use the Read tool to read each image file path provided
2. Analyze the visual content of the image(s)
3. Respond with your analysis directly - no preamble, no tool explanations
4. If the user requests JSON output, respond with valid JSON only`;

const config: CliProviderConfig = {
  name: 'claude-cli',
  displayName: 'Claude CLI',
  command: 'claude',
  timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
  knownModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
  buildArgs: (model, prompt, imagePaths, _options) => {
    const imageList = imagePaths.map((p) => `- ${p}`).join('\n');
    const fullPrompt = `Read and analyze these image files:\n${imageList}\n\n${prompt}`;
    const args: string[] = ['-p', fullPrompt, '--tools', 'Read', '--system-prompt', SYSTEM_PROMPT];
    if (model) {
      args.push('--model', model);
    }
    return args;
  },
};

export const ClaudeCliProviderLayer = createCliProviderLayer(config);

registerProvider('claude-cli', () => ClaudeCliProviderLayer, {
  displayName: config.displayName,
  type: 'cli',
  command: config.command,
  knownModels: config.knownModels,
});
