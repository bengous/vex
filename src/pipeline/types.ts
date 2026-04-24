/**
 * Pipeline runtime types for vex.
 *
 * Defines the operation interface, pipeline definition, and execution context
 * for composable visual analysis operations.
 */

import type {
  AnalysisResult,
  Artifact,
  ArtifactName,
  ArtifactType,
  Issue,
  ToolCall,
  ViewportConfig,
} from "../core/types.js";
import type { PlatformError } from "@effect/platform/Error";
import type { Effect } from "effect";
import { Data } from "effect";

// ═══════════════════════════════════════════════════════════════════════════
// Data Key Registry (Type-Safe Pipeline Data)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registry mapping semantic data keys to their value types.
 * Used by getData/storeData for compile-time type safety.
 *
 * Keys follow the pattern "operation:field" for node outputs.
 */
export type DataKeyRegistry = {
  "analyze:result": AnalysisResult;
  "annotate:toolCalls": readonly ToolCall[];
  "diff:pixelDiffPercent": number;
};

/**
 * Known data keys with type-safe access.
 */
export type DataKey = keyof DataKeyRegistry;

/**
 * Value type for a given data key.
 */
export type DataValue<K extends DataKey> = DataKeyRegistry[K];

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Operation execution failed.
 * Extends Data.TaggedError for proper Effect-TS integration:
 * - Structural equality via Equal.equals()
 * - Is an Error instance with stack trace
 * - Works with Effect.catchTag()
 */
export class OperationError extends Data.TaggedError("OperationError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `[${this.operation}] ${this.detail}`;
  }
}

/**
 * Pipeline execution failed.
 * Extends Data.TaggedError for proper Effect-TS integration:
 * - Structural equality via Equal.equals()
 * - Is an Error instance with stack trace
 * - Works with Effect.catchTag()
 */
export class PipelineError extends Data.TaggedError("PipelineError")<{
  readonly phase: "validation" | "execution" | "persistence";
  readonly detail: string;
  readonly cause?: OperationError;
}> {
  override get message(): string {
    return `[pipeline:${this.phase}] ${this.detail}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Operation Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pipeline execution context available to all operations.
 */
export type PipelineContext = {
  readonly sessionDir: string;
  readonly artifacts: Map<string, Artifact>;
  readonly logger: Logger;
  readonly storeArtifact: (artifact: Artifact) => string;
  readonly getArtifact: (id: string) => Artifact | undefined;

  /**
   * Get non-artifact data by known semantic key with type safety.
   * @example ctx.getData('analyze:result') // returns AnalysisResult | undefined
   */
  readonly getData: <K extends DataKey>(key: K) => DataValue<K> | undefined;

  /**
   * Get non-artifact data by dynamic key (e.g., "nodeId:field").
   * Use for dynamic edge routing; prefer getData for known keys.
   */
  readonly getDataRaw: (key: string) => unknown;

  /** Current viewport configuration (set by capture operation) */
  readonly viewport?: ViewportConfig;

  /**
   * Get the viewport directory path, creating it if needed.
   * Returns sessionDir/{deviceType}-{width}x{height}/
   * Falls back to sessionDir if no viewport is set.
   */
  readonly getViewportDir: () => Effect.Effect<string, PlatformError>;

  /**
   * Get the full path for a named artifact in the current viewport directory.
   * @param name - Artifact name key from ARTIFACT_NAMES
   * @returns Full path like sessionDir/desktop-1920x1080/01-screenshot.png
   */
  readonly getArtifactPath: (name: ArtifactName) => Effect.Effect<string, PlatformError>;
};

/**
 * Logger interface for operation output.
 */
export type Logger = {
  readonly debug: (message: string) => void;
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
};

/**
 * Operation definition - atomic unit of work in a pipeline.
 *
 * @template TInput - Input artifact or configuration type
 * @template TOutput - Output artifact type
 * @template TConfig - Operation-specific configuration
 */
export type Operation<TInput = unknown, TOutput = unknown, TConfig = Record<string, unknown>> = {
  /** Unique operation name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Artifact types this operation can consume */
  readonly inputTypes: readonly ArtifactType[];

  /** Artifact types this operation produces */
  readonly outputTypes: readonly ArtifactType[];

  /** Execute the operation */
  readonly execute: (
    input: TInput,
    config: TConfig,
    ctx: PipelineContext,
  ) => Effect.Effect<TOutput, OperationError>;
};

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Definition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Node in a pipeline DAG.
 */
export type PipelineNode = {
  readonly id: string;
  readonly operation: string;
  readonly config: Record<string, unknown>;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
};

/**
 * Edge connecting pipeline nodes.
 *
 * @property from - Source node ID
 * @property to - Target node ID
 * @property artifact - Output field name from source operation (used for lookup)
 * @property targetField - Input field name for target operation (defaults to artifact)
 */
export type PipelineEdge = {
  readonly from: string;
  readonly to: string;
  readonly artifact: string;
  readonly targetField?: string;
};

/**
 * Complete pipeline definition.
 */
export type PipelineDefinition = {
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly PipelineNode[];
  readonly edges: readonly PipelineEdge[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
};

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline State
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Node execution status.
 */
export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Per-node execution state.
 */
export type NodeState = {
  readonly id: string;
  readonly status: NodeStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly outputArtifacts: readonly string[];
  readonly error?: OperationError;
};

/**
 * Complete pipeline execution state.
 */
export type PipelineState = {
  readonly definition: PipelineDefinition;
  readonly sessionDir: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: "running" | "completed" | "failed" | "paused";
  readonly nodes: Record<string, NodeState>;
  readonly artifacts: Record<string, Artifact>;
  /** Non-artifact data passed between operations (e.g., AnalysisResult, ToolCall[]) */
  readonly data: Record<string, unknown>;
  readonly issues: Issue[];
  /** Map of semantic keys (e.g. nodeId:key) to physical artifact IDs to allow cross-node resolution */
  readonly semanticNames: Record<string, string>;
};

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Builder Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fluent builder for constructing pipelines.
 */
export type PipelineBuilder = {
  readonly name: (name: string) => PipelineBuilder;
  readonly description: (desc: string) => PipelineBuilder;
  readonly input: (name: string, type: ArtifactType) => PipelineBuilder;
  readonly operation: (
    id: string,
    operation: string,
    config?: Record<string, unknown>,
  ) => PipelineBuilder;
  readonly connect: (from: string, to: string, artifact?: string) => PipelineBuilder;
  readonly output: (name: string) => PipelineBuilder;
  readonly build: () => PipelineDefinition;
};

// ═══════════════════════════════════════════════════════════════════════════
// Operation Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registry of available operations.
 */
export type OperationRegistry = {
  readonly register: <T extends Operation>(operation: T) => void;
  readonly get: (name: string) => Operation | undefined;
  readonly list: () => readonly string[];
  readonly has: (name: string) => boolean;
};
