/**
 * Provider registry for runtime provider selection.
 *
 * Providers register factory functions that create layers on demand.
 * This enables runtime configuration (e.g., profiles).
 */

import { Effect, type Layer } from 'effect';
import { ProviderUnavailable, type VisionProvider } from './service.js';

/** Metadata about a registered provider */
export interface ProviderMetadata {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'http' | 'cli';
  readonly command?: string;
  /** Human-readable install instructions for CLI providers */
  readonly installHint?: string;
  readonly knownModels?: readonly string[];
  readonly modelAliases?: Record<string, string>;
}

/** Factory function that creates a provider layer, optionally with configuration */
export type ProviderFactory<TConfig = unknown> = (config?: TConfig) => Layer.Layer<VisionProvider>;

interface ProviderEntry {
  readonly factory: ProviderFactory;
  readonly metadata: ProviderMetadata;
}

const PROVIDER_ENTRIES = new Map<string, ProviderEntry>();

/**
 * Register a provider factory. Called by provider modules during import.
 *
 * @param name - Provider identifier (e.g., 'codex-cli')
 * @param factory - Factory function that creates the provider layer
 * @param metadata - Provider metadata for introspection
 */
export function registerProvider(
  name: string,
  factory: ProviderFactory,
  metadata?: Omit<ProviderMetadata, 'name'>,
): void {
  PROVIDER_ENTRIES.set(name, {
    factory,
    metadata: {
      name,
      displayName: metadata?.displayName ?? name,
      type: metadata?.type ?? 'http',
      command: metadata?.command,
      installHint: metadata?.installHint,
      knownModels: metadata?.knownModels,
      modelAliases: metadata?.modelAliases,
    },
  });
}

/**
 * Resolve provider Layer by name.
 *
 * @param name - Provider identifier
 * @param config - Optional configuration passed to provider factory
 */
export function resolveProviderLayer<TConfig = unknown>(
  name: string,
  config?: TConfig,
): Effect.Effect<Layer.Layer<VisionProvider>, ProviderUnavailable> {
  const entry = PROVIDER_ENTRIES.get(name);
  if (!entry) {
    return Effect.fail(
      new ProviderUnavailable({
        provider: name,
        reason: `Unknown provider: ${name}`,
        suggestion: `Available: ${[...PROVIDER_ENTRIES.keys()].join(', ')}`,
      }),
    );
  }
  return Effect.succeed(entry.factory(config));
}

/**
 * Get list of registered provider names.
 */
export function listProviderNames(): string[] {
  return [...PROVIDER_ENTRIES.keys()];
}

/**
 * Get metadata for a specific provider.
 */
export function getProviderMetadata(name: string): ProviderMetadata | undefined {
  return PROVIDER_ENTRIES.get(name)?.metadata;
}

/**
 * Get all provider metadata entries.
 */
export function getAllProviderMetadata(): ProviderMetadata[] {
  return [...PROVIDER_ENTRIES.values()].map((e) => e.metadata);
}
