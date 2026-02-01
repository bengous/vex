/**
 * Ollama vision provider.
 * Connects to local Ollama server via HTTP API.
 *
 * Default provider - uses HTTP instead of CLI for direct API access.
 */

import { Effect, Layer } from 'effect';
import { registerProvider } from '../shared/registry.js';
import { AnalysisFailed, VisionProvider, type VisionProviderService } from '../shared/service.js';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = 'qwen3-vl:8b';

interface OllamaResponse {
  response: string;
  done: boolean;
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

/** Read image file and return base64-encoded string */
function readImageBase64(path: string): Effect.Effect<string, AnalysisFailed> {
  return Effect.gen(function* () {
    const file = Bun.file(path);
    const exists = yield* Effect.promise(() => file.exists());
    if (!exists) {
      return yield* Effect.fail(
        new AnalysisFailed({
          provider: 'ollama',
          kind: 'image_read',
          message: `Image not found: ${path}`,
        }),
      );
    }
    const bytes = yield* Effect.promise(() => file.bytes());
    return Buffer.from(bytes).toString('base64');
  });
}

const OllamaProviderService: VisionProviderService = {
  name: 'ollama',
  displayName: 'Ollama',

  analyze: (images, prompt, options) =>
    Effect.gen(function* () {
      const model = options?.model ?? DEFAULT_MODEL;
      const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;

      const base64Images = yield* Effect.forEach(images, readImageBase64, {
        concurrency: 'unbounded',
      });

      const startMs = performance.now();
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt,
              images: base64Images,
              stream: false,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          }),
        catch: (err) => {
          if (err instanceof DOMException && err.name === 'TimeoutError') {
            return new AnalysisFailed({
              provider: 'ollama',
              kind: 'timeout',
              message: `Request timed out after ${timeoutMs}ms`,
            });
          }
          return new AnalysisFailed({
            provider: 'ollama',
            kind: 'http',
            message: err instanceof Error ? err.message : String(err),
          });
        },
      });

      if (!response.ok) {
        const text = yield* Effect.promise(() => response.text());
        return yield* Effect.fail(
          new AnalysisFailed({
            provider: 'ollama',
            kind: 'http',
            message: `HTTP ${response.status}`,
            cause: text,
          }),
        );
      }

      const data = (yield* Effect.promise(() => response.json())) as OllamaResponse;

      return {
        response: data.response,
        durationMs: Math.round(performance.now() - startMs),
        model,
        provider: 'ollama',
      };
    }),

  isAvailable: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      },
      catch: () => false as const,
    }).pipe(Effect.orElseSucceed(() => false)),

  listModels: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!res.ok) return [] as readonly string[];
        const data = (await res.json()) as OllamaTagsResponse;
        return data.models.map((m) => m.name);
      },
      catch: () => [] as readonly string[],
    }).pipe(Effect.orElseSucceed(() => [] as readonly string[])),

  hasModel: (model) =>
    Effect.gen(function* () {
      const models = yield* OllamaProviderService.listModels();
      const base = model.split(':')[0];
      return models.some((m) => m === model || m.startsWith(`${base}:`));
    }),

  normalizeModel: (model) => model,
};

export const OllamaProviderLayer = Layer.succeed(VisionProvider, OllamaProviderService);

registerProvider('ollama', OllamaProviderLayer, {
  displayName: 'Ollama',
  type: 'http',
});
