/**
 * Verification module - compares iterations to detect improvements/regressions.
 *
 * Compares baseline and current pipeline states to determine:
 * - Which issues were resolved
 * - Which issues were introduced
 * - Which issues remain unchanged
 * - Overall improvement verdict
 */

import { Effect } from 'effect';
import type { Issue } from '../core/types.js';
import type { PipelineState } from '../pipeline/types.js';
import type { LoopError, VerificationMetrics, VerificationResult, VerificationVerdict } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Issue Comparison
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a fingerprint for an issue based on description and region.
 * Used for fuzzy matching between iterations.
 */
function issueFingerprint(issue: Issue): string {
  const descWords = issue.description.toLowerCase().split(/\s+/).slice(0, 5).sort().join(' ');
  const regionKey =
    typeof issue.region === 'string'
      ? issue.region
      : `${Math.round(issue.region.x / 100)},${Math.round(issue.region.y / 100)}`;
  return `${issue.severity}:${regionKey}:${descWords}`;
}

/**
 * Find similar issues between two sets using fingerprinting.
 */
function findSimilarIssue(issue: Issue, candidates: readonly Issue[]): Issue | null {
  const fingerprint = issueFingerprint(issue);
  for (const candidate of candidates) {
    if (issueFingerprint(candidate) === fingerprint) {
      return candidate;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Verification Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate verification metrics.
 */
function calculateMetrics(
  baselineIssues: readonly Issue[],
  currentIssues: readonly Issue[],
  resolved: readonly Issue[],
  introduced: readonly Issue[],
  unchanged: readonly Issue[],
): VerificationMetrics {
  const baselineCount = baselineIssues.length;
  const currentCount = currentIssues.length;
  const resolvedCount = resolved.length;
  const introducedCount = introduced.length;
  const unchangedCount = unchanged.length;

  const improvementPercent =
    baselineCount > 0 ? ((resolvedCount - introducedCount) / baselineCount) * 100 : currentCount === 0 ? 100 : 0;

  return {
    baselineIssueCount: baselineCount,
    currentIssueCount: currentCount,
    resolvedCount,
    introducedCount,
    unchangedCount,
    improvementPercent: Math.round(improvementPercent * 100) / 100,
  };
}

/**
 * Determine overall verdict based on metrics.
 */
function determineVerdict(metrics: VerificationMetrics): VerificationVerdict {
  const { resolvedCount, introducedCount, unchangedCount } = metrics;

  if (introducedCount === 0 && resolvedCount > 0) {
    return 'improved';
  }

  if (introducedCount > 0 && resolvedCount === 0) {
    return 'regressed';
  }

  if (introducedCount > 0 && resolvedCount > 0) {
    return resolvedCount > introducedCount ? 'mixed' : 'regressed';
  }

  if (resolvedCount === 0 && introducedCount === 0 && unchangedCount > 0) {
    return 'unchanged';
  }

  // No issues in either baseline or current
  return metrics.currentIssueCount === 0 ? 'improved' : 'unchanged';
}

/**
 * Verify changes between baseline and current pipeline states.
 */
export function verifyChanges(
  baseline: PipelineState,
  current: PipelineState,
): Effect.Effect<VerificationResult, LoopError> {
  const baselineIssues = baseline.issues;
  const currentIssues = current.issues;

  const resolved: Issue[] = [];
  const introduced: Issue[] = [];
  const unchanged: Issue[] = [];

  // Find resolved and unchanged issues
  for (const baseIssue of baselineIssues) {
    const match = findSimilarIssue(baseIssue, currentIssues);
    if (match) {
      unchanged.push(baseIssue);
    } else {
      resolved.push(baseIssue);
    }
  }

  // Find introduced issues
  for (const curIssue of currentIssues) {
    const match = findSimilarIssue(curIssue, baselineIssues);
    if (!match) {
      introduced.push(curIssue);
    }
  }

  const metrics = calculateMetrics(baselineIssues, currentIssues, resolved, introduced, unchanged);
  const verdict = determineVerdict(metrics);

  // Pixel diff placeholder - would require image comparison in full implementation
  const pixelDiffPercent = 0;

  return Effect.succeed({
    resolved,
    introduced,
    unchanged,
    pixelDiffPercent,
    verdict,
    metrics,
  });
}

/**
 * Quick check if current state is better than baseline.
 */
export function isImproved(baseline: PipelineState, current: PipelineState): boolean {
  const baselineCount = baseline.issues.length;
  const currentCount = current.issues.length;
  return currentCount < baselineCount;
}

/**
 * Check if all issues are resolved.
 */
export function isResolved(state: PipelineState): boolean {
  return state.issues.length === 0;
}
