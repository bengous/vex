/**
 * Shared analysis utilities for VLM-powered visual analysis.
 *
 * Provides analyzeWithRetry - a retry-then-fallback pattern for handling
 * validation failures in LLM responses.
 */

import type { Issue } from "./schema.js";
import { Effect } from "effect";
import {
  buildRetryPrompt,
  parseIssuesFromResponse,
  parseIssuesStrict,
  ValidationRetryNeeded,
} from "./validation.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base vision result from a provider.
 */
export type VisionResult = {
  readonly response: string;
  readonly durationMs: number;
  readonly model: string;
  readonly provider: string;
};

/**
 * Vision result with parsed issues.
 */
export type VisionResultWithIssues = {
  readonly issues: readonly Issue[];
} & VisionResult;

/**
 * Options for analyzeWithRetry.
 *
 * @template E - Error type from the caller's analyze callback
 * @property analyze - Callback to call VLM, pre-composed with provider layer
 * @property prompt - The analysis prompt to send
 * @property logger - Optional logger for retry messages
 */
export type AnalyzeWithRetryOptions<E> = {
  readonly analyze: (prompt: string) => Effect.Effect<VisionResult, E>;
  readonly prompt: string;
  readonly logger?: { warn: (msg: string) => void };
};

// ═══════════════════════════════════════════════════════════════════════════
// Core Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze with strict validation, retrying with schema reminder on failure.
 *
 * Pattern:
 * 1. Call VLM with prompt and parse response with strict validation
 * 2. On ValidationRetryNeeded, retry with a schema-reminder prompt
 * 3. Use partial recovery on retry (never fails, returns valid issues only)
 *
 * Callers provide the `analyze` callback pre-composed with their layer:
 *
 * @example
 * ```typescript
 * // CLI usage
 * const analyze = (prompt: string) =>
 *   Effect.gen(function* () {
 *     const provider = yield* VisionProvider;
 *     return yield* provider.analyze([imagePath], prompt, { model });
 *   }).pipe(Effect.provide(providerLayer));
 *
 * const result = yield* analyzeWithRetry({ analyze, prompt, logger });
 * ```
 */
export function analyzeWithRetry<E>(
  options: AnalyzeWithRetryOptions<E>,
): Effect.Effect<VisionResultWithIssues, E> {
  const { analyze, prompt, logger } = options;

  // Strict analysis: calls VLM and parses with strict validation
  // Error type is E | ValidationRetryNeeded
  const analyzeStrict = (analysisPrompt: string) =>
    Effect.gen(function* () {
      const result = yield* analyze(analysisPrompt);
      const issues = yield* parseIssuesStrict(result.response);
      return { ...result, issues };
    });

  // Recovery analysis: calls VLM and parses with partial recovery (never fails on parsing)
  // Error type is E (from analyze callback only)
  const analyzeWithRecovery = (analysisPrompt: string) =>
    Effect.gen(function* () {
      const result = yield* analyze(analysisPrompt);
      const issues = yield* parseIssuesFromResponse(result.response, logger);
      return { ...result, issues };
    });

  // catchAll handles all errors, but only recovers from ValidationRetryNeeded
  return analyzeStrict(prompt).pipe(
    Effect.catchAll((err) => {
      // Type guard: only handle ValidationRetryNeeded, re-throw others
      if (err instanceof ValidationRetryNeeded) {
        logger?.warn(`Validation failed (${err.reason}), retrying with schema reminder`);
        const retryPrompt = buildRetryPrompt(prompt, err);
        return analyzeWithRecovery(retryPrompt);
      }
      return Effect.fail(err);
    }),
  );
}
