/**
 * Effect Schema definitions for vex configuration.
 *
 * Single source of truth for CLI args and config file validation.
 * TypeScript types are derived directly from schemas.
 */

import { Schema as S } from 'effect';
import { CodexProfile } from '../providers/codex-cli/schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Primitive Schemas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valid HTTP(S) URL.
 */
export const Url = S.String.pipe(
  S.pattern(/^https?:\/\/.+/, { message: () => 'Must be a valid http:// or https:// URL' }),
);
export type Url = S.Schema.Type<typeof Url>;

/**
 * Device preset identifiers.
 * Matches ALL_DEVICE_IDS from core/devices.ts.
 */
export const DeviceId = S.Literal(
  // Desktops
  'desktop-1920',
  'desktop-b3ngous-arch',
  'desktop-1366',
  'desktop-hidpi',
  // iPhones
  'iphone-15-pro-max',
  'iphone-15-pro',
  'iphone-se',
  // Android
  'pixel-7',
  'galaxy-s24',
  // Tablets
  'ipad-pro-11',
  'galaxy-tab-s9',
);
export type DeviceId = S.Schema.Type<typeof DeviceId>;

/**
 * Device specification: single device or array of devices.
 */
export const DeviceSpec = S.Union(DeviceId, S.Array(DeviceId));
export type DeviceSpec = S.Schema.Type<typeof DeviceSpec>;

/**
 * Supported VLM provider names.
 */
export const ProviderName = S.Literal('ollama', 'codex-cli', 'claude-cli', 'gemini-cli');
export type ProviderName = S.Schema.Type<typeof ProviderName>;

/**
 * Reasoning effort levels for codex-cli.
 */
export const ReasoningLevel = S.Literal('low', 'medium', 'high', 'xhigh');
export type ReasoningLevel = S.Schema.Type<typeof ReasoningLevel>;

/**
 * Auto-fix confidence thresholds for loop command.
 */
export const AutoFixThreshold = S.Literal('high', 'medium', 'none');
export type AutoFixThreshold = S.Schema.Type<typeof AutoFixThreshold>;

/**
 * Positive integer (for maxIterations, etc.).
 */
export const PositiveInt = S.Number.pipe(
  S.int({ message: () => 'Must be an integer' }),
  S.positive({ message: () => 'Must be positive' }),
);
export type PositiveInt = S.Schema.Type<typeof PositiveInt>;

/**
 * CSS selector string.
 */
export const CssSelector = S.String.pipe(S.minLength(1, { message: () => 'CSS selector cannot be empty' }));
export type CssSelector = S.Schema.Type<typeof CssSelector>;

/**
 * Placeholder media configuration for replacing images/videos with boxes.
 *
 * This is the schema input type. When resolved, it becomes ResolvedPlaceholderMedia
 * (in cli/resolve.ts), which is compatible with core PlaceholderMediaOptions.
 */
export const PlaceholderMediaConfig = S.Struct({
  /** Minimum size (px) for SVG placeholders (default: 100) */
  svgMinSize: S.optional(S.Number.pipe(S.positive({ message: () => 'svgMinSize must be positive' }))),
  /** CSS selectors for elements to preserve (not replace) */
  preserve: S.optional(S.Array(CssSelector)),
});
export type PlaceholderMediaConfig = S.Schema.Type<typeof PlaceholderMediaConfig>;

/**
 * Placeholder media specification: boolean (use defaults) or detailed config.
 */
export const PlaceholderMediaSpec = S.Union(S.Boolean, PlaceholderMediaConfig);
export type PlaceholderMediaSpec = S.Schema.Type<typeof PlaceholderMediaSpec>;

/**
 * Full-page scroll fix configuration for apps using internal scroll containers.
 *
 * When enabled, capture can temporarily force root/container overflow to visible
 * so Playwright fullPage includes full content.
 */
export const FullPageScrollFixConfig = S.Struct({
  /** CSS selectors for scroll container(s) to expand */
  selectors: S.optional(S.Array(CssSelector)),
  /** Wait time after style injection before screenshot (ms, default: 500) */
  settleMs: S.optional(PositiveInt),
});
export type FullPageScrollFixConfig = S.Schema.Type<typeof FullPageScrollFixConfig>;

/**
 * Full-page scroll fix specification: boolean (use defaults) or detailed config.
 */
export const FullPageScrollFixSpec = S.Union(S.Boolean, FullPageScrollFixConfig);
export type FullPageScrollFixSpec = S.Schema.Type<typeof FullPageScrollFixSpec>;

/**
 * Profile name: alphanumeric with hyphens/underscores, no colons.
 * Used for both built-in and user-defined profiles.
 */
export const ProfileName = S.String.pipe(
  S.pattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: () => 'Profile name must start with a letter and contain only letters, numbers, hyphens, or underscores',
  }),
);
export type ProfileName = S.Schema.Type<typeof ProfileName>;

// ═══════════════════════════════════════════════════════════════════════════
// Provider Discriminated Union
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ollama provider configuration.
 */
export const OllamaProvider = S.Struct({
  name: S.Literal('ollama'),
  model: S.optional(S.String),
});
export type OllamaProvider = S.Schema.Type<typeof OllamaProvider>;

/**
 * Codex CLI provider configuration.
 */
export const CodexProvider = S.Struct({
  name: S.Literal('codex-cli'),
  model: S.optional(S.String),
  reasoning: S.optional(ReasoningLevel),
  /** Profile name for sandbox/approval settings */
  profile: S.optional(ProfileName),
});
export type CodexProvider = S.Schema.Type<typeof CodexProvider>;

/**
 * Claude CLI provider configuration.
 */
export const ClaudeProvider = S.Struct({
  name: S.Literal('claude-cli'),
  model: S.optional(S.String),
});
export type ClaudeProvider = S.Schema.Type<typeof ClaudeProvider>;

/**
 * Gemini CLI provider configuration.
 */
export const GeminiProvider = S.Struct({
  name: S.Literal('gemini-cli'),
  model: S.optional(S.String),
});
export type GeminiProvider = S.Schema.Type<typeof GeminiProvider>;

/**
 * Provider specification - discriminated union of all providers.
 */
export const ProviderSpec = S.Union(OllamaProvider, CodexProvider, ClaudeProvider, GeminiProvider);
export type ProviderSpec = S.Schema.Type<typeof ProviderSpec>;

// ═══════════════════════════════════════════════════════════════════════════
// Preset Schemas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan command preset configuration.
 */
export const ScanPreset = S.Struct({
  /** URLs to scan (if not provided via CLI) */
  urls: S.optional(S.Array(Url)),
  /** Device(s) to use */
  devices: S.optional(DeviceSpec),
  /** VLM provider configuration */
  provider: S.optional(ProviderSpec),
  /** Run full annotation pipeline */
  full: S.optional(S.Boolean),
  /** Replace images/videos with placeholder boxes (true for defaults, or object for custom) */
  placeholderMedia: S.optional(PlaceholderMediaSpec),
  /** Expand internal scroll container(s) for true full-page screenshots */
  fullPageScrollFix: S.optional(FullPageScrollFixSpec),
});
export type ScanPreset = S.Schema.Type<typeof ScanPreset>;

/**
 * Loop command preset configuration.
 */
export const LoopPreset = S.Struct({
  /** URLs to iterate on (if not provided via CLI) */
  urls: S.optional(S.Array(Url)),
  /** Device(s) to use */
  devices: S.optional(DeviceSpec),
  /** VLM provider configuration */
  provider: S.optional(ProviderSpec),
  /** Maximum iterations before stopping */
  maxIterations: S.optional(PositiveInt),
  /** Auto-fix confidence threshold */
  autoFix: S.optional(AutoFixThreshold),
  /** Dry run mode (no code changes) */
  dryRun: S.optional(S.Boolean),
  /** Replace images/videos with placeholder boxes (true for defaults, or object for custom) */
  placeholderMedia: S.optional(PlaceholderMediaSpec),
  /** Expand internal scroll container(s) for true full-page screenshots */
  fullPageScrollFix: S.optional(FullPageScrollFixSpec),
});
export type LoopPreset = S.Schema.Type<typeof LoopPreset>;

// ═══════════════════════════════════════════════════════════════════════════
// Root Configuration Schema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Provider-specific profiles configuration.
 */
export const ProvidersConfig = S.Struct({
  /** User-defined Codex CLI profiles */
  codex: S.optional(S.Record({ key: ProfileName, value: CodexProfile })),
});
export type ProvidersConfig = S.Schema.Type<typeof ProvidersConfig>;

/**
 * Root vex configuration file schema.
 */
export const VexConfig = S.Struct({
  /** Base output directory for sessions (required) */
  outputDir: S.String,
  /** Named presets for the scan command */
  scanPresets: S.optional(S.Record({ key: S.String, value: ScanPreset })),
  /** Named presets for the loop command */
  loopPresets: S.optional(S.Record({ key: S.String, value: LoopPreset })),
  /** Provider-specific configuration (profiles, etc.) */
  providers: S.optional(ProvidersConfig),
});
export type VexConfig = S.Schema.Type<typeof VexConfig>;

// ═══════════════════════════════════════════════════════════════════════════
// Helper: defineConfig
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Type-safe config helper for vex.config.ts files.
 * Provides autocomplete and validation at edit-time.
 *
 * @example
 * ```typescript
 * import { defineConfig } from './vex/config/index.js';
 *
 * export default defineConfig({
 *   outputDir: 'vex-output',
 *   scanPresets: {
 *     quick: {
 *       devices: 'desktop-1920',
 *       provider: { name: 'codex-cli', reasoning: 'low' },
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(config: VexConfig): VexConfig {
  return config;
}
