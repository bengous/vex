/**
 * Feedback loop types for vex.
 *
 * Orchestrates iterative improvement cycles:
 * capture → analyze → locate → fix → verify → repeat
 */

import { Data } from 'effect';
import type { CodeLocation, Issue, ViewportConfig } from '../core/types.js';
import type { PipelineState } from '../pipeline/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loop execution failed.
 * Extends Data.TaggedError for proper Effect-TS integration:
 * - Structural equality via Equal.equals()
 * - Is an Error instance with stack trace
 * - Works with Effect.catchTag()
 */
export class LoopError extends Data.TaggedError('LoopError')<{
  readonly phase: 'capture' | 'analyze' | 'locate' | 'fix' | 'verify';
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `[loop:${this.phase}] ${this.detail}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-fix threshold settings.
 */
export type AutoFixThreshold = 'high' | 'medium' | 'none';

/**
 * Loop execution options.
 */
export interface LoopOptions {
  /** Target URL to analyze */
  readonly url: string;

  /** Maximum iterations before stopping */
  readonly maxIterations: number;

  /** Pause for human review between iterations */
  readonly interactive: boolean;

  /** Auto-fix issues at or above this confidence */
  readonly autoFixThreshold: AutoFixThreshold;

  /** Viewport configurations to test */
  readonly viewports: readonly ViewportConfig[];

  /** VLM provider to use */
  readonly provider: string;

  /** Model override */
  readonly model?: string;

  /** Session directory (auto-generated if not provided) */
  readonly sessionDir?: string;

  /** Project root for code search (required - no default) */
  readonly projectRoot: string;

  /** Run without applying any code changes */
  readonly dryRun?: boolean;
}

/** Default loop options */
export const DEFAULT_LOOP_OPTIONS: Partial<LoopOptions> = {
  maxIterations: 5,
  interactive: true,
  autoFixThreshold: 'high',
};

// ═══════════════════════════════════════════════════════════════════════════
// Verification Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verification verdict after comparing iterations.
 */
export type VerificationVerdict = 'improved' | 'regressed' | 'unchanged' | 'mixed';

/**
 * Result of verifying changes between iterations.
 */
export interface VerificationResult {
  /** Issues that were resolved */
  readonly resolved: readonly Issue[];

  /** New issues introduced */
  readonly introduced: readonly Issue[];

  /** Issues that remain unchanged */
  readonly unchanged: readonly Issue[];

  /** Pixel difference percentage */
  readonly pixelDiffPercent: number;

  /** Overall verdict */
  readonly verdict: VerificationVerdict;

  /** Detailed comparison metrics */
  readonly metrics: VerificationMetrics;
}

/**
 * Detailed metrics for verification.
 */
export interface VerificationMetrics {
  readonly baselineIssueCount: number;
  readonly currentIssueCount: number;
  readonly resolvedCount: number;
  readonly introducedCount: number;
  readonly unchangedCount: number;
  readonly improvementPercent: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Gate Types (Human-in-the-Loop)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actions that can be taken for an issue.
 */
export type GateAction = 'auto-fix' | 'human-review' | 'skip' | 'abort';

/**
 * Decision made by the gate for an issue.
 */
export interface GateDecision {
  readonly action: GateAction;
  readonly issue: Issue;
  readonly location?: CodeLocation;
  readonly reasoning: string;
}

/**
 * Human response to a review request.
 */
export interface HumanResponse {
  readonly action: 'apply' | 'skip' | 'modify' | 'abort';
  readonly location?: CodeLocation;
  readonly modification?: string;
  readonly feedback?: string;
}

/**
 * Gate configuration.
 */
export interface GateConfig {
  /** Confidence threshold for auto-fix */
  readonly autoFixConfidence: AutoFixThreshold;

  /** Severity threshold for human review */
  readonly humanReviewSeverity: Issue['severity'];

  /** Allow multi-file changes without review */
  readonly allowMultiFileAutoFix: boolean;

  /** Maximum auto-fixes per iteration */
  readonly maxAutoFixesPerIteration: number;
}

/** Default gate configuration */
export const DEFAULT_GATE_CONFIG: GateConfig = {
  autoFixConfidence: 'high',
  humanReviewSeverity: 'high',
  allowMultiFileAutoFix: false,
  maxAutoFixesPerIteration: 3,
};

// ═══════════════════════════════════════════════════════════════════════════
// Loop State & Results
// ═══════════════════════════════════════════════════════════════════════════

/**
 * State of a single loop iteration.
 */
export interface IterationState {
  readonly number: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly pipelineState: PipelineState;
  readonly issuesFound: readonly Issue[];
  readonly fixesApplied: readonly AppliedFix[];
  readonly verification?: VerificationResult;
}

/**
 * Record of an applied fix.
 */
export interface AppliedFix {
  readonly issue: Issue;
  readonly location: CodeLocation;
  readonly action: 'auto' | 'manual';
  readonly timestamp: string;
  readonly diff?: string;
}

/**
 * Loop execution status.
 */
export type LoopStatus =
  | 'running'
  | 'paused-for-review'
  | 'completed-resolved'
  | 'completed-max-iterations'
  | 'completed-no-improvement'
  | 'failed'
  | 'aborted';

/**
 * Final loop result.
 */
export interface LoopResult {
  readonly status: LoopStatus;
  readonly iterations: number;
  readonly sessionDir: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly initialIssueCount: number;
  readonly finalIssueCount: number;
  readonly totalFixesApplied: number;
  readonly iterationHistory: readonly IterationState[];
  readonly finalVerification?: VerificationResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-iteration metrics for tracking progress.
 */
export interface IterationMetrics {
  readonly iteration: number;
  readonly issueCount: number;
  readonly fixesApplied: number;
  readonly captureDurationMs: number;
  readonly analysisDurationMs: number;
  readonly locatorDurationMs: number;
  readonly totalDurationMs: number;
}

/**
 * Aggregate metrics across all iterations.
 */
export interface LoopMetrics {
  readonly totalIterations: number;
  readonly totalDurationMs: number;
  readonly issueResolutionRate: number;
  readonly averageIterationDurationMs: number;
  readonly iterationMetrics: readonly IterationMetrics[];
  readonly bySeverity: Record<Issue['severity'], { initial: number; final: number }>;
}
