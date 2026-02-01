/**
 * Analyze operation - sends image to VLM for analysis.
 */

import { Effect } from 'effect';
import {
  type AnalysisArtifact,
  type AnalysisResult,
  GRID_CONFIG,
  type ImageArtifact,
  type Issue,
  type ViewportConfig,
} from '../../core/types.js';
import { resolveProviderLayer, VisionProvider } from '../../providers/index.js';
import type { Operation, OperationError } from '../types.js';

export interface AnalyzeConfig {
  readonly provider: string;
  readonly model?: string;
  readonly prompt?: string;
  readonly reasoning?: string;
}

/** Providers that support the reasoning effort option */
const REASONING_PROVIDERS = ['codex-cli'] as const;

export interface AnalyzeInput {
  readonly image: ImageArtifact;
}

export interface AnalyzeOutput {
  readonly analysis: AnalysisArtifact;
  readonly result: AnalysisResult;
}

/**
 * Build the analysis prompt with optional viewport context.
 * Includes viewport dimensions and grid scale to prevent VLMs from
 * misinterpreting desktop screenshots as mobile viewports.
 */
function buildAnalysisPrompt(viewport?: ViewportConfig): string {
  const viewportContext = viewport
    ? `\nViewport: ${viewport.width}×${viewport.height}px (${viewport.isMobile ? 'mobile' : 'desktop'})
Grid: Each cell (A1, B2, etc.) is ${GRID_CONFIG.cellSize}×${GRID_CONFIG.cellSize} pixels.\n`
    : '';

  return `Analyze this web page screenshot for visual and layout issues.${viewportContext}
For each issue found, provide:
1. A clear description of the problem
2. The severity (high, medium, low)
3. The approximate location using grid cell references (A1-J99) or pixel coordinates
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

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'analyze', message, cause };
}

function parseIssues(response: string): Issue[] {
  try {
    const jsonMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.issues)) return [];

    return parsed.issues.map((issue: Record<string, unknown>, idx: number) => ({
      id: typeof issue.id === 'number' ? issue.id : idx + 1,
      description: String(issue.description ?? ''),
      severity: ['high', 'medium', 'low'].includes(String(issue.severity)) ? issue.severity : 'medium',
      region: issue.region ?? 'A1',
      suggestedFix: issue.suggestedFix ? String(issue.suggestedFix) : undefined,
    })) as Issue[];
  } catch {
    return [];
  }
}

export const analyzeOperation: Operation<AnalyzeInput, AnalyzeOutput, AnalyzeConfig> = {
  name: 'analyze',
  description: 'Analyze image with VLM for visual issues',
  inputTypes: ['image'],
  outputTypes: ['analysis'],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { provider, model, prompt, reasoning } = config;
      const viewport = input.image.metadata.viewport;
      const effectivePrompt = prompt ?? buildAnalysisPrompt(viewport);

      // Validate reasoning is only used with supported providers
      if (reasoning && !REASONING_PROVIDERS.includes(provider as (typeof REASONING_PROVIDERS)[number])) {
        return yield* Effect.fail(
          makeError(
            `Provider '${provider}' does not support --reasoning. Supported: ${REASONING_PROVIDERS.join(', ')}`,
          ),
        );
      }

      ctx.logger.info(`Analyzing ${input.image.path} with ${provider}`);

      const providerLayer = yield* resolveProviderLayer(provider).pipe(
        Effect.mapError((e) => makeError(`Provider error: ${e.reason}`, e)),
      );

      const visionResult = yield* Effect.gen(function* () {
        const visionProvider = yield* VisionProvider;
        return yield* visionProvider.analyze([input.image.path], effectivePrompt, { model, reasoning });
      }).pipe(
        Effect.provide(providerLayer),
        Effect.mapError((e) => makeError('Analysis failed', e)),
      );

      const issues = parseIssues(visionResult.response);

      const result: AnalysisResult = {
        provider: visionResult.provider,
        model: visionResult.model,
        response: visionResult.response,
        durationMs: visionResult.durationMs,
        issues,
      };

      const outputPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('analysis'),
        catch: (e) => makeError('Failed to get output path', e),
      });

      yield* Effect.tryPromise({
        try: () => Bun.write(outputPath, JSON.stringify(result, null, 2)),
        catch: (e) => makeError('Failed to save analysis', e),
      });

      const artifact: AnalysisArtifact = {
        id: `analysis_${Date.now()}`,
        type: 'analysis',
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'analyze',
        metadata: {
          provider: result.provider,
          model: result.model,
          durationMs: result.durationMs,
          issueCount: issues.length,
        },
      };

      ctx.storeArtifact(artifact);
      return { analysis: artifact, result };
    }),
};
