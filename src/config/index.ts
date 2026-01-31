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

// Schema exports
export {
  // Primitives
  Url,
  DeviceId,
  DeviceSpec,
  ProviderName,
  ReasoningLevel,
  AutoFixThreshold,
  PositiveInt,
  // Providers
  OllamaProvider,
  CodexProvider,
  ClaudeProvider,
  GeminiProvider,
  ProviderSpec,
  // Presets
  ScanPreset,
  LoopPreset,
  // Root config
  VexConfig,
  // Helper
  defineConfig,
} from './schema.js';

// Type exports
export type {
  Url as UrlType,
  DeviceId as DeviceIdType,
  DeviceSpec as DeviceSpecType,
  ProviderName as ProviderNameType,
  ReasoningLevel as ReasoningLevelType,
  AutoFixThreshold as AutoFixThresholdType,
  PositiveInt as PositiveIntType,
  OllamaProvider as OllamaProviderType,
  CodexProvider as CodexProviderType,
  ClaudeProvider as ClaudeProviderType,
  GeminiProvider as GeminiProviderType,
  ProviderSpec as ProviderSpecType,
  ScanPreset as ScanPresetType,
  LoopPreset as LoopPresetType,
  VexConfig as VexConfigType,
} from './schema.js';

// Loader exports
export {
  ConfigError,
  loadConfig,
  loadConfigOptional,
  getScanPreset,
  getLoopPreset,
  findProjectRoot,
} from './loader.js';
