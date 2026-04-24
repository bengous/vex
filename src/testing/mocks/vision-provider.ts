/**
 * Mock VisionProvider factory for operation unit tests.
 *
 * Provides configurable mock implementations of VisionProviderService
 * for testing analyze and annotate operations in isolation.
 */

import type {
  ProviderError,
  VisionProviderService,
  VisionResult,
} from "../../providers/shared/service.js";
import { Effect, Layer } from "effect";
import { AnalysisFailed, VisionProvider } from "../../providers/shared/service.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type MockVisionProviderOptions = {
  readonly name?: string;
  readonly displayName?: string;
  /** VisionResult for success, or ProviderError to simulate failure */
  readonly analyzeResponse?: VisionResult | ProviderError;
  readonly isAvailable?: boolean;
  readonly models?: readonly string[];
  /** Callback to capture analyze call arguments for assertions */
  readonly onAnalyze?: (images: readonly string[], prompt: string) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// Fixture Factories
// ═══════════════════════════════════════════════════════════════════════════

export function createMockVisionResult(overrides: Partial<VisionResult> = {}): VisionResult {
  return {
    response: '{"issues": []}',
    durationMs: 100,
    model: "mock-model",
    provider: "mock-provider",
    ...overrides,
  };
}

export function createMockAnalysisError(
  overrides: Partial<{
    provider: string;
    kind: "timeout" | "execution" | "http" | "image_read" | "parse";
    message: string;
  }> = {},
): AnalysisFailed {
  return new AnalysisFailed({
    provider: "mock-provider",
    kind: "execution",
    message: "Mock analysis failed",
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock Service Factory
// ═══════════════════════════════════════════════════════════════════════════

export function createMockVisionProvider(
  options: MockVisionProviderOptions = {},
): VisionProviderService {
  const {
    name = "mock-provider",
    displayName = "Mock Provider",
    analyzeResponse = createMockVisionResult(),
    isAvailable = true,
    models = ["mock-model"],
    onAnalyze,
  } = options;

  return {
    name,
    displayName,
    analyze: (images: readonly string[], prompt: string) => {
      onAnalyze?.(images, prompt);
      if ("_tag" in analyzeResponse) {
        return Effect.fail(analyzeResponse);
      }
      return Effect.succeed(analyzeResponse);
    },
    isAvailable: () => Effect.succeed(isAvailable),
    listModels: () => Effect.succeed(models),
    hasModel: (model: string) => Effect.succeed(models.includes(model)),
    normalizeModel: (model: string) => model,
  };
}

export function createMockVisionProviderLayer(
  options: MockVisionProviderOptions = {},
): Layer.Layer<VisionProvider> {
  return Layer.succeed(VisionProvider, createMockVisionProvider(options));
}
