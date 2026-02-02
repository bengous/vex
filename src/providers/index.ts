/**
 * VLM provider backends for vex.
 *
 * Effect.ts Architecture:
 * - VisionProvider: Service tag for dependency injection
 * - Tagged errors: Pattern-matchable error types
 * - Layer registration: Runtime provider selection
 *
 * @module vex/providers
 */

// Re-export shared types and services
export { getAllProviders, getProviderInfo, type ProviderInfo } from './shared/introspection.js';

export {
  getAllProviderMetadata,
  getProviderMetadata,
  listProviderNames,
  type ProviderMetadata,
  registerProvider,
  resolveProviderLayer,
} from './shared/registry.js';

export {
  AnalysisFailed,
  type ProviderError,
  ProviderUnavailable,
  VisionProvider,
  type VisionProviderService,
  type VisionQueryOptions,
  type VisionResult,
} from './shared/service.js';

export { Subprocess, SubprocessError, SubprocessLive, type SubprocessResult } from './shared/subprocess.js';

// Import providers for self-registration (order matters: first registered = default)
import './ollama/index.js';
import './claude-cli/index.js';
import './codex-cli/index.js';
import './gemini-cli/index.js';
