/**
 * Provider registry for runtime provider selection.
 */

import { Effect, type Layer } from 'effect';
import { ProviderUnavailable, type VisionProvider } from './service.js';

const PROVIDER_LAYERS = new Map<string, Layer.Layer<VisionProvider>>();

/**
 * Register a provider Layer. Called by provider modules during import.
 */
export function registerProvider(name: string, layer: Layer.Layer<VisionProvider>): void {
  PROVIDER_LAYERS.set(name, layer);
}

/**
 * Resolve provider Layer by name.
 */
export function resolveProviderLayer(name: string): Effect.Effect<Layer.Layer<VisionProvider>, ProviderUnavailable> {
  const layer = PROVIDER_LAYERS.get(name);
  if (!layer) {
    return Effect.fail(
      new ProviderUnavailable({
        provider: name,
        reason: `Unknown provider: ${name}`,
        suggestion: `Available: ${[...PROVIDER_LAYERS.keys()].join(', ')}`,
      }),
    );
  }
  return Effect.succeed(layer);
}

/**
 * Get list of registered provider names.
 */
export function listProviderNames(): string[] {
  return [...PROVIDER_LAYERS.keys()];
}
