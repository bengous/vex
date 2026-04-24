/**
 * Shared provider layer resolution with OperationError wrapping.
 */

import { Effect } from "effect";
import { resolveProviderLayer } from "../../providers/shared/registry.js";
import { OperationError } from "../types.js";

/**
 * Resolve a provider layer, mapping ProviderUnavailable to OperationError.
 */
export function resolveProviderForOperation(provider: string, operation: string) {
  return resolveProviderLayer(provider).pipe(
    Effect.mapError(
      (e) => new OperationError({ operation, detail: `Provider error: ${e.reason}`, cause: e }),
    ),
  );
}
