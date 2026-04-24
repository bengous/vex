/**
 * Vision provider service definition.
 *
 * This file contains the core Effect.ts service definition.
 * Provider implementations import from here to avoid circular dependencies.
 */

import type { Effect } from "effect";
import { Context, Data } from "effect";

// ═══════════════════════════════════════════════════════════════════════════
// Error Types - Explicit, typed, pattern-matchable
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Provider is not available (server not running, CLI not installed).
 */
export class ProviderUnavailable extends Data.TaggedError("ProviderUnavailable")<{
  readonly provider: string;
  readonly reason: string;
  readonly suggestion?: string;
}> {}

/**
 * Analysis operation failed.
 */
export class AnalysisFailed extends Data.TaggedError("AnalysisFailed")<{
  readonly provider: string;
  readonly kind: "timeout" | "execution" | "http" | "image_read" | "parse";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ProviderError = ProviderUnavailable | AnalysisFailed;

// ═══════════════════════════════════════════════════════════════════════════
// Service Interface - What providers must implement
// ═══════════════════════════════════════════════════════════════════════════

export type VisionResult = {
  readonly response: string;
  readonly durationMs: number;
  readonly model: string;
  readonly provider: string;
};

export type VisionQueryOptions = {
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly reasoning?: string;
};

/**
 * VisionProvider service contract.
 *
 * LLM Implementation Guide:
 * - analyze: Core method - send images + prompt to vision model
 * - isAvailable: Check if provider can be used (server running, CLI installed)
 * - listModels: Optional - return available models or empty array
 * - hasModel: Optional - validate model exists, defaults to true
 * - normalizeModel: Optional - map aliases like "sonnet" -> "claude-sonnet-4-..."
 */
export type VisionProviderService = {
  readonly name: string;
  readonly displayName: string;

  readonly analyze: (
    images: readonly string[],
    prompt: string,
    options?: VisionQueryOptions,
  ) => Effect.Effect<VisionResult, ProviderError>;

  /** Never fails - returns false if unavailable */
  readonly isAvailable: () => Effect.Effect<boolean>;

  /** Returns available models or empty array on error (never fails) */
  readonly listModels: () => Effect.Effect<readonly string[]>;

  /** Returns true if model available, true by default for CLI providers (never fails) */
  readonly hasModel: (model: string) => Effect.Effect<boolean>;

  readonly normalizeModel: (model: string) => string;
};

/** Effect Service Tag - dependency injection point */
export class VisionProvider extends Context.Tag("vex/providers/shared/service/VisionProvider")<
  VisionProvider,
  VisionProviderService
>() {}
