/**
 * Metrics module - tracking iteration and loop performance.
 *
 * Tracks per-iteration metrics:
 * - Issue counts
 * - Fixes applied
 * - Duration breakdowns
 *
 * Aggregates across iterations:
 * - Resolution rate
 * - Average iteration time
 * - Breakdown by severity
 */

import type { Issue, Severity } from '../core/types.js';
import type { IterationMetrics, IterationState, LoopMetrics } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Iteration Metrics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create metrics for a completed iteration.
 */
export function createIterationMetrics(
  iteration: number,
  issueCount: number,
  fixesApplied: number,
  durations: {
    capture?: number;
    analysis?: number;
    locator?: number;
    total: number;
  },
): IterationMetrics {
  return {
    iteration,
    issueCount,
    fixesApplied,
    captureDurationMs: durations.capture ?? 0,
    analysisDurationMs: durations.analysis ?? 0,
    locatorDurationMs: durations.locator ?? 0,
    totalDurationMs: durations.total,
  };
}

/**
 * Extract metrics from an iteration state.
 */
export function metricsFromState(state: IterationState): IterationMetrics {
  const startTime = new Date(state.startedAt).getTime();
  const endTime = state.completedAt ? new Date(state.completedAt).getTime() : Date.now();

  return {
    iteration: state.number,
    issueCount: state.issuesFound.length,
    fixesApplied: state.fixesApplied.length,
    captureDurationMs: 0, // Not tracked at state level
    analysisDurationMs: 0,
    locatorDurationMs: 0,
    totalDurationMs: endTime - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop Metrics
// ═══════════════════════════════════════════════════════════════════════════

interface SeveritySnapshot {
  readonly initial: number;
  readonly final: number;
}

/**
 * Calculate aggregate metrics from iteration history.
 */
export function calculateLoopMetrics(
  iterations: readonly IterationState[],
  initialIssues: readonly Issue[],
  finalIssues: readonly Issue[],
): LoopMetrics {
  if (iterations.length === 0) {
    return {
      totalIterations: 0,
      totalDurationMs: 0,
      issueResolutionRate: 0,
      averageIterationDurationMs: 0,
      iterationMetrics: [],
      bySeverity: {
        high: { initial: 0, final: 0 },
        medium: { initial: 0, final: 0 },
        low: { initial: 0, final: 0 },
      },
    };
  }

  const iterationMetrics = iterations.map(metricsFromState);

  const totalDurationMs = iterationMetrics.reduce((sum, m) => sum + m.totalDurationMs, 0);

  const initialCount = initialIssues.length;
  const finalCount = finalIssues.length;
  const resolvedCount = Math.max(0, initialCount - finalCount);
  const issueResolutionRate = initialCount > 0 ? resolvedCount / initialCount : finalCount === 0 ? 1 : 0;

  const bySeverity: Record<Severity, SeveritySnapshot> = {
    high: { initial: 0, final: 0 },
    medium: { initial: 0, final: 0 },
    low: { initial: 0, final: 0 },
  };

  for (const issue of initialIssues) {
    bySeverity[issue.severity] = {
      ...bySeverity[issue.severity],
      initial: bySeverity[issue.severity].initial + 1,
    };
  }

  for (const issue of finalIssues) {
    bySeverity[issue.severity] = {
      ...bySeverity[issue.severity],
      final: bySeverity[issue.severity].final + 1,
    };
  }

  return {
    totalIterations: iterations.length,
    totalDurationMs,
    issueResolutionRate: Math.round(issueResolutionRate * 100) / 100,
    averageIterationDurationMs: Math.round(totalDurationMs / iterations.length),
    iterationMetrics,
    bySeverity,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Metric Formatters
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format duration in human-readable format.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format resolution rate as percentage.
 */
export function formatResolutionRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Generate a summary string for loop metrics.
 */
export function summarizeMetrics(metrics: LoopMetrics): string {
  const lines: string[] = [
    `Iterations: ${metrics.totalIterations}`,
    `Duration: ${formatDuration(metrics.totalDurationMs)}`,
    `Resolution rate: ${formatResolutionRate(metrics.issueResolutionRate)}`,
    '',
    'By severity:',
    `  High: ${metrics.bySeverity.high.initial} → ${metrics.bySeverity.high.final}`,
    `  Medium: ${metrics.bySeverity.medium.initial} → ${metrics.bySeverity.medium.final}`,
    `  Low: ${metrics.bySeverity.low.initial} → ${metrics.bySeverity.low.final}`,
  ];
  return lines.join('\n');
}
