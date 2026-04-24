/**
 * Ollama vision provider.
 * Connects to local Ollama server via HTTP API.
 *
 * Default provider - uses @effect/platform HttpClient for typed HTTP errors.
 */

import type { VisionProviderService } from "../shared/service.js";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Duration, Effect, Layer, Schema } from "effect";
import { registerProvider } from "../shared/registry.js";
import { AnalysisFailed, VisionProvider } from "../shared/service.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = "qwen3-vl:8b";

// ═══════════════════════════════════════════════════════════════════════════
// Response Schemas - typed validation for Ollama API responses
// ═══════════════════════════════════════════════════════════════════════════

const OllamaResponseSchema = Schema.Struct({
  response: Schema.String,
  done: Schema.Boolean,
});

const OllamaTagsResponseSchema = Schema.Struct({
  models: Schema.Array(Schema.Struct({ name: Schema.String })),
});

/** Read image file and return base64-encoded string */
function readImageBase64(path: string): Effect.Effect<string, AnalysisFailed> {
  return Effect.gen(function* () {
    const file = Bun.file(path);
    const exists = yield* Effect.promise(async () => file.exists());
    if (!exists) {
      return yield* new AnalysisFailed({
        provider: "ollama",
        kind: "image_read",
        message: `Image not found: ${path}`,
      });
    }
    const bytes = yield* Effect.promise(async () => file.bytes());
    return Buffer.from(bytes).toString("base64");
  });
}

export const OllamaProviderLayer: Layer.Layer<VisionProvider> = Layer.effect(
  VisionProvider,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient.pipe(Effect.map(HttpClient.filterStatusOk));

    const service: VisionProviderService = {
      name: "ollama",
      displayName: "Ollama",

      analyze: (images, prompt, options) =>
        Effect.gen(function* () {
          const model = options?.model ?? DEFAULT_MODEL;
          const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;

          const base64Images = yield* Effect.forEach(images, readImageBase64, {
            concurrency: "unbounded",
          });

          const startMs = performance.now();

          const request = HttpClientRequest.post(`${OLLAMA_URL}/api/generate`).pipe(
            HttpClientRequest.bodyUnsafeJson({
              model,
              prompt,
              images: base64Images,
              stream: false,
            }),
          );

          const data = yield* client.execute(request).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(OllamaResponseSchema)),
            Effect.timeout(Duration.millis(timeoutMs)),
            Effect.catchTags({
              TimeoutException: () =>
                Effect.fail(
                  new AnalysisFailed({
                    provider: "ollama",
                    kind: "timeout",
                    message: `Request timed out after ${timeoutMs}ms`,
                  }),
                ),
              RequestError: (e) =>
                Effect.fail(
                  new AnalysisFailed({
                    provider: "ollama",
                    kind: "http",
                    message: e.message,
                  }),
                ),
              ResponseError: (e) =>
                Effect.fail(
                  new AnalysisFailed({
                    provider: "ollama",
                    kind: "http",
                    message: `HTTP ${e.response.status}`,
                  }),
                ),
              ParseError: (e) =>
                Effect.fail(
                  new AnalysisFailed({
                    provider: "ollama",
                    kind: "parse",
                    message: `Invalid response: ${e.message}`,
                  }),
                ),
            }),
          );

          return {
            response: data.response,
            durationMs: Math.round(performance.now() - startMs),
            model,
            provider: "ollama",
          };
        }),

      isAvailable: () =>
        client.get(`${OLLAMA_URL}/api/tags`).pipe(
          Effect.timeout(Duration.millis(5000)),
          Effect.map(() => true),
          Effect.orElseSucceed(() => false),
        ),

      listModels: () =>
        client.get(`${OLLAMA_URL}/api/tags`).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(OllamaTagsResponseSchema)),
          Effect.map((data) => data.models.map((m) => m.name)),
          Effect.orElseSucceed(() => [] as readonly string[]),
        ),

      hasModel: (model) =>
        service.listModels().pipe(
          Effect.map((models) => {
            const base = model.split(":")[0];
            return models.some((m) => m === model || m.startsWith(`${base}:`));
          }),
        ),

      normalizeModel: (model) => model,
    };

    return service;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

registerProvider("ollama", () => OllamaProviderLayer, {
  displayName: "Ollama",
  type: "http",
});
