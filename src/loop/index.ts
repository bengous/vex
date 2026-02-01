/**
 * Feedback loop for vex - iterative improvement cycles.
 *
 * @module vex/loop
 */

export { evaluateGate, evaluateGates, filterByAction, summarizeDecisions } from './gates.js';
export {
  calculateLoopMetrics,
  createIterationMetrics,
  formatDuration,
  formatResolutionRate,
  metricsFromState,
  summarizeMetrics,
} from './metrics.js';

export type { LocateResult, LoopCallbacks, LoopCaptureResult } from './orchestrator.js';
export { LoopOrchestrator, runLoop } from './orchestrator.js';
export type {
  AppliedFix,
  AutoFixThreshold,
  GateAction,
  GateConfig,
  GateDecision,
  HumanResponse,
  IterationMetrics,
  IterationState,
  LoopError,
  LoopMetrics,
  LoopOptions,
  LoopResult,
  LoopStatus,
  VerificationMetrics,
  VerificationResult,
  VerificationVerdict,
} from './types.js';
export { DEFAULT_GATE_CONFIG, DEFAULT_LOOP_OPTIONS } from './types.js';
export { isImproved, isResolved, verifyChanges } from './verify.js';
