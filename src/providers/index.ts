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

// Re-export registry functions
export {
  getAllProviderMetadata,
  getProviderMetadata,
  listProviderNames,
  type ProviderMetadata,
  registerProvider,
  resolveProviderLayer,
} from './registry.js';

// Re-export introspection functions
export { getAllProviders, getProviderInfo, type ProviderInfo } from './introspection.js';

// Re-export service types and tag
export {
  AnalysisFailed,
  type ProviderError,
  ProviderUnavailable,
  VisionProvider,
  type VisionProviderService,
  type VisionQueryOptions,
  type VisionResult,
} from './service.js';

// Import providers for self-registration (order matters: first registered = default)
import './ollama.js';
import './claude-cli.js';
import './codex-cli.js';
import './gemini-cli.js';
