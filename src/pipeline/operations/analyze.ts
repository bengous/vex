/**
 * Analyze operation - sends image to VLM for analysis.
 */

import type {
  AnalysisArtifact,
  AnalysisResult,
  ImageArtifact,
  ViewportConfig,
} from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import { analyzeWithRetry } from "../../core/analysis.js";
import { GRID_CONFIG } from "../../core/types.js";
import { VisionProvider } from "../../providers/shared/service.js";
import { OperationError } from "../types.js";
import { resolveProviderForOperation } from "./resolve-provider.js";

export type AnalyzeConfig = {
  readonly provider: string;
  readonly model?: string;
  readonly prompt?: string;
  readonly reasoning?: string;
};

/** Providers that support the reasoning effort option */
const REASONING_PROVIDERS = ["codex-cli"] as const;

export type AnalyzeInput = {
  readonly image: ImageArtifact;
};

export type AnalyzeOutput = {
  readonly analysis: AnalysisArtifact;
  readonly result: AnalysisResult;
};

/**
 * Build the analysis prompt with optional viewport context.
 * Includes viewport dimensions and grid scale to prevent VLMs from
 * misinterpreting desktop screenshots as mobile viewports.
 */
function buildAnalysisPrompt(viewport?: ViewportConfig): string {
  const viewportContext =
    viewport !== undefined
      ? `\nViewport: ${viewport.width}×${viewport.height}px (${viewport.isMobile ? "mobile" : "desktop"})
Grid: Each cell (A1, B2, etc.) is ${GRID_CONFIG.cellSize}×${GRID_CONFIG.cellSize} pixels.\n`
      : "";

  return `Analyze this web page screenshot for visual and layout issues.${viewportContext}
For each issue found, provide:
1. A clear description of the problem
2. The severity (high, medium, low)
3. The approximate location using grid cell references (A1-Z99) or pixel coordinates
4. A suggested fix

Format your response as JSON:
{
  "issues": [
    {
      "id": 1,
      "description": "...",
      "severity": "high|medium|low",
      "region": "A1" or {"x": 0, "y": 0, "width": 100, "height": 100},
      "suggestedFix": "..."
    }
  ]
}`;
}

export const analyzeOperation: Operation<AnalyzeInput, AnalyzeOutput, AnalyzeConfig> = {
  name: "analyze",
  description: "Analyze image with VLM for visual issues",
  inputTypes: ["image"],
  outputTypes: ["analysis"],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { provider, model, prompt, reasoning } = config;
      const viewport = input.image.metadata.viewport;
      const effectivePrompt = prompt ?? buildAnalysisPrompt(viewport);

      // Validate reasoning is only used with supported providers
      if (
        reasoning !== undefined &&
        reasoning.length > 0 &&
        !REASONING_PROVIDERS.includes(provider as (typeof REASONING_PROVIDERS)[number])
      ) {
        return yield* new OperationError({
          operation: "analyze",
          detail: `Provider '${provider}' does not support --reasoning. Supported: ${REASONING_PROVIDERS.join(", ")}`,
        });
      }

      ctx.logger.info(`Analyzing ${input.image.path} with ${provider}`);

      const providerLayer = yield* resolveProviderForOperation(provider, "analyze");

      // Create analyze callback pre-composed with provider layer
      const analyze = (analysisPrompt: string) => {
        const providerEffect = Effect.gen(function* () {
          const visionProvider = yield* VisionProvider;
          return yield* visionProvider.analyze([input.image.path], analysisPrompt, {
            ...(model !== undefined ? { model } : {}),
            ...(reasoning !== undefined ? { reasoning } : {}),
          });
        });
        // @effect-diagnostics-next-line strictEffectProvide:off
        return providerEffect.pipe(Effect.provide(providerLayer));
      };

      // Use shared retry logic from core/analysis.ts
      const visionResult = yield* analyzeWithRetry({
        analyze,
        prompt: effectivePrompt,
        logger: ctx.logger,
      }).pipe(
        Effect.mapError(
          (e) => new OperationError({ operation: "analyze", detail: "Analysis failed", cause: e }),
        ),
      );

      const result: AnalysisResult = {
        provider: visionResult.provider,
        model: visionResult.model,
        response: visionResult.response,
        durationMs: visionResult.durationMs,
        issues: visionResult.issues,
      };

      const outputPath = yield* ctx.getArtifactPath("analysis").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "analyze",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => Bun.write(outputPath, JSON.stringify(result, null, 2)),
        catch: (e) =>
          new OperationError({ operation: "analyze", detail: "Failed to save analysis", cause: e }),
      });

      const artifact: AnalysisArtifact = {
        _kind: "artifact",
        id: crypto.randomUUID(),
        type: "analysis",
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: "analyze",
        metadata: {
          provider: result.provider,
          model: result.model,
          durationMs: result.durationMs,
          issueCount: result.issues.length,
        },
      };

      ctx.storeArtifact(artifact);
      return { analysis: artifact, result };
    }),
};
