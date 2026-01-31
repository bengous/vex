/**
 * Feedback loop for vex - iterative improvement cycles.
 *
 * @module vex/loop
 */


// Gates
export { evaluateGate, evaluateGates, filterByAction, summarizeDecisions } from './gates.js';
// Metrics
export {
  calculateLoopMetrics,
  createIterationMetrics,
  formatDuration,
  formatResolutionRate,
  metricsFromState,
  summarizeMetrics,
} from './metrics.js';

// Orchestrator
export type { LocateResult, LoopCallbacks, LoopCaptureResult } from './orchestrator.js';
export { LoopOrchestrator, runLoop } from './orchestrator.js';
export type {
  AppliedFix,
  // Configuration
  AutoFixThreshold,
  // Gates
  GateAction,
  GateConfig,
  GateDecision,
  HumanResponse,
  // Metrics
  IterationMetrics,
  // State & Results
  IterationState,
  // Errors
  LoopError,
  LoopMetrics,
  LoopOptions,
  LoopResult,
  LoopStatus,
  VerificationMetrics,
  VerificationResult,
  // Verification
  VerificationVerdict,
} from './types.js';
export { DEFAULT_GATE_CONFIG, DEFAULT_LOOP_OPTIONS } from './types.js';
// Verification
export { isImproved, isResolved, verifyChanges } from './verify.js';
