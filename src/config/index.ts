/**
 * Vex configuration module.
 *
 * @example
 * ```typescript
 * // In vex.config.ts
 * import { defineConfig } from './vex/config/index.js';
 *
 * export default defineConfig({
 *   outputDir: 'vex-output',
 *   scanPresets: {
 *     quick: { devices: 'desktop-1920' },
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Loading config programmatically
 * import { loadConfig, getScanPreset } from './vex/config/index.js';
 * import { Effect } from 'effect';
 *
 * const config = await Effect.runPromise(loadConfig());
 * const preset = await Effect.runPromise(getScanPreset(config, 'quick'));
 * ```
 */

export {
  ConfigError,
  findProjectRoot,
  getLoopPreset,
  getScanPreset,
  loadConfig,
  loadConfigOptional,
} from './loader.js';

export type {
  AutoFixThreshold as AutoFixThresholdType,
  ClaudeProvider as ClaudeProviderType,
  CodexProvider as CodexProviderType,
  DeviceId as DeviceIdType,
  DeviceSpec as DeviceSpecType,
  GeminiProvider as GeminiProviderType,
  LoopPreset as LoopPresetType,
  OllamaProvider as OllamaProviderType,
  PositiveInt as PositiveIntType,
  ProviderName as ProviderNameType,
  ProviderSpec as ProviderSpecType,
  ReasoningLevel as ReasoningLevelType,
  ScanPreset as ScanPresetType,
  Url as UrlType,
  VexConfig as VexConfigType,
} from './schema.js';

export {
  AutoFixThreshold,
  ClaudeProvider,
  CodexProvider,
  DeviceId,
  DeviceSpec,
  defineConfig,
  GeminiProvider,
  LoopPreset,
  OllamaProvider,
  PositiveInt,
  ProviderName,
  ProviderSpec,
  ReasoningLevel,
  ScanPreset,
  Url,
  VexConfig,
} from './schema.js';
