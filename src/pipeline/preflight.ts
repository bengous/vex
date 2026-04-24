/**
 * Pre-flight checks before pipeline execution.
 */

import { Effect } from "effect";
import { ProviderNotInstalled } from "../providers/shared/errors.js";
import { getProviderMetadata } from "../providers/shared/registry.js";
import { Subprocess } from "../providers/shared/subprocess.js";

/**
 * Verify CLI provider is installed.
 * HTTP providers (like ollama) skip this check.
 */
export function checkProviderInstalled(
  providerName: string,
): Effect.Effect<void, ProviderNotInstalled, Subprocess> {
  return Effect.gen(function* () {
    const metadata = getProviderMetadata(providerName);
    if (metadata?.command === undefined || metadata.command.length === 0) {
      return;
    } // HTTP providers don't need CLI check

    const subprocess = yield* Subprocess;
    const exists = yield* subprocess.commandExists(metadata.command);

    if (!exists) {
      return yield* new ProviderNotInstalled({
        provider: providerName,
        command: metadata.command,
        ...(metadata.installHint !== undefined ? { installHint: metadata.installHint } : {}),
      });
    }
  });
}
