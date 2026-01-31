/**
 * Gemini CLI vision provider.
 * Shells out to the Google `gemini` command for vision analysis.
 */

import { CLI_DEFAULT_TIMEOUT_MS, type CliProviderConfig, createCliProviderLayer } from './cli-factory.js';
import { registerProvider } from './registry.js';

const config: CliProviderConfig = {
  name: 'gemini-cli',
  displayName: 'Gemini CLI',
  command: 'gemini',
  timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
  knownModels: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
  ],
  modelAliases: {
    flash: 'gemini-2.5-flash',
    'flash-lite': 'gemini-2.5-flash-lite',
    pro: 'gemini-2.5-pro',
    '3-flash': 'gemini-3-flash-preview',
    '3-pro': 'gemini-3-pro-preview',
  },
  buildArgs: (model, prompt, imagePaths, _options) => {
    const fileRefs = imagePaths.map((p) => `@${p}`).join(' ');
    const args = ['--yolo'];
    if (model) args.push('-m', model);
    args.push('-p', `${prompt} ${fileRefs}`);
    return args;
  },
};

export const GeminiCliProviderLayer = createCliProviderLayer(config);

registerProvider('gemini-cli', GeminiCliProviderLayer, {
  displayName: config.displayName,
  type: 'cli',
  command: config.command,
  knownModels: config.knownModels,
  modelAliases: config.modelAliases,
});
