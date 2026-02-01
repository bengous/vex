/**
 * Provider introspection for CLI discovery.
 * Gathers runtime information about registered providers.
 */

import { Effect } from 'effect';
import { getAllProviderMetadata, type ProviderMetadata, resolveProviderLayer } from './registry.js';
import { VisionProvider } from './service.js';

/** Complete provider info including runtime state */
export interface ProviderInfo extends ProviderMetadata {
  readonly available: boolean;
  /** Models from the provider (fetched from server for HTTP providers, or knownModels for CLI) */
  readonly models: readonly string[];
}

/**
 * Get detailed info for a single provider.
 * Checks availability and fetches models.
 */
export function getProviderInfo(name: string): Effect.Effect<ProviderInfo | undefined, never> {
  const metadata = getAllProviderMetadata().find((m) => m.name === name);
  if (!metadata) return Effect.succeed(undefined);

  return Effect.gen(function* () {
    const layer = yield* resolveProviderLayer(name).pipe(Effect.orElseSucceed(() => undefined));
    if (!layer) {
      return {
        ...metadata,
        available: false,
        models: metadata.knownModels ?? [],
      };
    }

    const available = yield* Effect.provide(
      Effect.flatMap(VisionProvider, (p) => p.isAvailable()),
      layer,
    ).pipe(Effect.orElseSucceed(() => false));

    const models = yield* Effect.provide(
      Effect.flatMap(VisionProvider, (p) => p.listModels()),
      layer,
    ).pipe(Effect.orElseSucceed(() => metadata.knownModels ?? []));

    return {
      ...metadata,
      available,
      models: models.length > 0 ? models : (metadata.knownModels ?? []),
    };
  });
}

/**
 * Get info for all registered providers.
 * Checks availability in parallel for efficiency.
 */
export function getAllProviders(): Effect.Effect<ProviderInfo[], never> {
  const allMetadata = getAllProviderMetadata();

  return Effect.forEach(allMetadata, (metadata) => getProviderInfo(metadata.name), {
    concurrency: 'unbounded',
  }).pipe(
    // Filter out undefined (shouldn't happen since we're iterating registered providers,
    // but the type system can't prove this - use type guard instead of non-null assertion)
    Effect.map((infos) => infos.filter((info): info is ProviderInfo => info !== undefined)),
  );
}
