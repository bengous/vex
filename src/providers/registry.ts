/**
 * Provider registry for runtime provider selection.
 */

import { Effect, type Layer } from 'effect';
import { ProviderUnavailable, type VisionProvider } from './service.js';

/** Metadata about a registered provider */
export interface ProviderMetadata {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'http' | 'cli';
  readonly command?: string;
  readonly knownModels?: readonly string[];
  readonly modelAliases?: Record<string, string>;
}

interface ProviderEntry {
  readonly layer: Layer.Layer<VisionProvider>;
  readonly metadata: ProviderMetadata;
}

const PROVIDER_ENTRIES = new Map<string, ProviderEntry>();

/**
 * Register a provider Layer. Called by provider modules during import.
 */
export function registerProvider(
  name: string,
  layer: Layer.Layer<VisionProvider>,
  metadata?: Omit<ProviderMetadata, 'name'>,
): void {
  PROVIDER_ENTRIES.set(name, {
    layer,
    metadata: {
      name,
      displayName: metadata?.displayName ?? name,
      type: metadata?.type ?? 'http',
      command: metadata?.command,
      knownModels: metadata?.knownModels,
      modelAliases: metadata?.modelAliases,
    },
  });
}

/**
 * Resolve provider Layer by name.
 */
export function resolveProviderLayer(name: string): Effect.Effect<Layer.Layer<VisionProvider>, ProviderUnavailable> {
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
  return Effect.succeed(entry.layer);
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
