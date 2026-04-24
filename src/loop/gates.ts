/**
 * Gates module - human-in-the-loop decision making for issue resolution.
 *
 * Decision matrix (ordered):
 * 1. Multi-file + !allowMultiFileAutoFix -> human-review
 * 2. low confidence -> human-review
 * 3. medium confidence + severity >= humanReviewSeverity -> human-review
 * 4. single-file + confidence >= autoFixConfidence -> auto-fix
 * 5. otherwise -> human-review
 */

import type { CodeLocation, Issue, Severity } from "../core/types.js";
import type { AutoFixThreshold, GateAction, GateConfig, GateDecision } from "./types.js";
import { CONFIDENCE_RANK } from "../core/schema.js";
import { DEFAULT_GATE_CONFIG } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Severity Ordering
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isSeverityAtLeast(actual: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[actual] <= SEVERITY_RANK[threshold];
}

function isConfidenceAtLeast(
  actual: CodeLocation["confidence"],
  threshold: AutoFixThreshold,
): boolean {
  if (threshold === "none") {
    return false;
  }
  return CONFIDENCE_RANK[actual] <= CONFIDENCE_RANK[threshold as CodeLocation["confidence"]];
}

// ═══════════════════════════════════════════════════════════════════════════
// Scope Detection
// ═══════════════════════════════════════════════════════════════════════════

type ResolutionScope = {
  isSingleFile: boolean;
  files: string[];
};

function analyzeScope(locations: readonly CodeLocation[]): ResolutionScope {
  const files = [...new Set(locations.map((l) => l.file))];
  return {
    isSingleFile: files.length === 1,
    files,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Decision Logic
// ═══════════════════════════════════════════════════════════════════════════

function buildReasoning(
  action: GateAction,
  confidence: CodeLocation["confidence"],
  severity: Severity,
  scope: ResolutionScope,
): string {
  const parts: string[] = [];

  if (action === "auto-fix") {
    parts.push(`Auto-fixing: ${confidence} confidence`);
    if (scope.isSingleFile) {
      parts.push(`single file (${scope.files[0]})`);
    }
  } else if (action === "human-review") {
    if (!scope.isSingleFile) {
      parts.push(`Requires review: multi-file change (${scope.files.length} files)`);
    } else if (confidence === "low") {
      parts.push("Requires review: low confidence location");
    } else if (severity === "high") {
      parts.push("Requires review: high severity issue");
    } else {
      parts.push("Requires review");
    }
  } else if (action === "skip") {
    parts.push("Skipped: no suitable code location found");
  }

  return parts.join(", ") || `Action: ${action}`;
}

/**
 * Evaluate gate decision for an issue with its code locations.
 */
export function evaluateGate(
  issue: Issue,
  locations: readonly CodeLocation[],
  config: Partial<GateConfig> = {},
): GateDecision {
  const opts = { ...DEFAULT_GATE_CONFIG, ...config };

  if (locations.length === 0) {
    return {
      action: "skip",
      issue,
      reasoning: "No code locations found for this issue",
    };
  }

  const bestLocation = locations[0]; // Already sorted by confidence
  if (bestLocation === undefined) {
    return {
      action: "skip",
      issue,
      reasoning: "No valid code location",
    };
  }

  const scope = analyzeScope(locations);
  const confidence = bestLocation.confidence;
  const severity = issue.severity;

  let action: GateAction;

  // Multi-file always requires review (unless explicitly allowed)
  if (!scope.isSingleFile && !opts.allowMultiFileAutoFix) {
    action = "human-review";
  }
  // Low confidence always requires review
  else if (confidence === "low") {
    action = "human-review";
  }
  // Medium confidence with high severity = review
  else if (confidence === "medium" && isSeverityAtLeast(severity, opts.humanReviewSeverity)) {
    action = "human-review";
  }
  // Auto-fix if threshold is met
  else if (isConfidenceAtLeast(confidence, opts.autoFixConfidence) && scope.isSingleFile) {
    action = "auto-fix";
  }
  // Default to review
  else {
    action = "human-review";
  }

  return {
    action,
    issue,
    location: bestLocation,
    reasoning: buildReasoning(action, confidence, severity, scope),
  };
}

/**
 * Batch evaluate gates for multiple issues.
 */
export function evaluateGates(
  issuesWithLocations: Array<{ issue: Issue; locations: readonly CodeLocation[] }>,
  config: Partial<GateConfig> = {},
): GateDecision[] {
  const opts = { ...DEFAULT_GATE_CONFIG, ...config };
  const decisions: GateDecision[] = [];
  let autoFixCount = 0;

  for (const { issue, locations } of issuesWithLocations) {
    let decision = evaluateGate(issue, locations, opts);

    if (decision.action === "auto-fix") {
      if (autoFixCount >= opts.maxAutoFixesPerIteration) {
        decision = {
          ...decision,
          action: "human-review",
          reasoning: `${decision.reasoning} (auto-fix limit reached)`,
        };
      } else {
        autoFixCount++;
      }
    }

    decisions.push(decision);
  }

  return decisions;
}

/**
 * Filter decisions by action type.
 */
export function filterByAction(
  decisions: readonly GateDecision[],
  action: GateAction,
): GateDecision[] {
  return decisions.filter((d) => d.action === action);
}

/**
 * Get summary of gate decisions.
 */
export function summarizeDecisions(decisions: readonly GateDecision[]): Record<GateAction, number> {
  const summary: Record<GateAction, number> = {
    "auto-fix": 0,
    "human-review": 0,
    skip: 0,
    abort: 0,
  };

  for (const decision of decisions) {
    summary[decision.action]++;
  }

  return summary;
}
