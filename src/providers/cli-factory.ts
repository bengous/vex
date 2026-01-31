/**
 * CLI Provider Factory.
 * Creates VisionProvider implementations that shell out to CLI commands.
 *
 * LLM Extension Guide:
 * 1. Define CliProviderConfig with buildArgs function
 * 2. Call createCliProviderLayer() to get a Layer
 * 3. Import in providers/index.ts for self-registration
 *
 * Example:
 *   const config: CliProviderConfig = {
 *     name: "my-cli",
 *     displayName: "My CLI Tool",
 *     command: "mytool",
 *     timeoutMs: 300_000,
 *     buildArgs: (model, prompt, images) => ["--prompt", prompt, ...images],
 *   };
 *   export const MyCliProviderLayer = createCliProviderLayer(config);
 *   registerProvider("my-cli", MyCliProviderLayer);
 */

import { Effect, Layer } from 'effect';
import { AnalysisFailed, VisionProvider, type VisionProviderService, type VisionQueryOptions } from './service.js';
import { Subprocess, type SubprocessError, SubprocessLive } from './subprocess.js';

/** Default timeout for CLI providers (5 minutes) - longer than HTTP due to CLI startup overhead */
export const CLI_DEFAULT_TIMEOUT_MS = 300_000;

export interface CliProviderConfig {
  readonly name: string;
  readonly displayName: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly modelAliases?: Record<string, string>;
  /** Build command arguments from inputs */
  readonly buildArgs: (
    model: string,
    prompt: string,
    imagePaths: readonly string[],
    options?: VisionQueryOptions,
  ) => readonly string[];
}

/** Convert SubprocessError to AnalysisFailed */
function mapSubprocessError(provider: string, err: SubprocessError): AnalysisFailed {
  return new AnalysisFailed({
    provider,
    kind: err.timedOut ? 'timeout' : 'execution',
    message: err.timedOut ? `Command timed out` : `Exit code ${err.exitCode}`,
    cause: err.stderr || undefined,
  });
}

/**
 * Create a Layer for a CLI provider.
 * Includes SubprocessLive as a dependency.
 */
export function createCliProviderLayer(config: CliProviderConfig): Layer.Layer<VisionProvider> {
  const { name, displayName, command, timeoutMs, modelAliases, buildArgs } = config;

  const providerLayer = Layer.effect(
    VisionProvider,
    Effect.gen(function* () {
      const subprocess = yield* Subprocess;

      return {
        name,
        displayName,

        analyze: (images, prompt, options) => {
          const rawModel = options?.model ?? '';
          const model = modelAliases?.[rawModel.toLowerCase()] ?? rawModel;
          const timeout = options?.timeoutMs ?? timeoutMs;
          const args = buildArgs(model, prompt, images, options);

          return subprocess.exec(command, args, timeout).pipe(
            Effect.map((result) => ({
              response: result.stdout.trim(),
              durationMs: result.durationMs,
              model,
              provider: name,
            })),
            Effect.mapError((err) => mapSubprocessError(name, err)),
          );
        },

        isAvailable: () => subprocess.commandExists(command),

        listModels: () => Effect.succeed([] as readonly string[]),

        hasModel: () => Effect.succeed(true),

        normalizeModel: (model: string) => modelAliases?.[model.toLowerCase()] ?? model,
      } as VisionProviderService;
    }),
  );

  return Layer.provide(providerLayer, SubprocessLive);
}
