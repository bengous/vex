/**
 * Loop Orchestrator - main feedback loop for iterative visual improvement.
 *
 * Workflow:
 * 1. CAPTURE - Take screenshot with DOM snapshot
 * 2. ANALYZE - Run VLM analysis to detect issues
 * 3. LOCATE - Map issues to code locations
 * 4. FIX - Apply fixes based on gate decisions
 * 5. VERIFY - Check for improvements/regressions
 * 6. REPEAT - Until resolved, max iterations, or aborted
 */

import type { CodeLocation, DOMSnapshot, Issue, ViewportConfig } from "../core/types.js";
import type { LocatorContext } from "../locator/types.js";
import type { PipelineState } from "../pipeline/types.js";
import type {
  AppliedFix,
  GateConfig,
  GateDecision,
  HumanResponse,
  IterationState,
  LoopOptions,
  LoopResult,
  LoopStatus,
  VerificationResult,
} from "./types.js";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { loadDOMSnapshotFromPath } from "../core/dom-snapshot-loader.js";
import { createResolverWithStrategies } from "../locator/resolver.js";
import { DEFAULT_FILE_PATTERNS, domTracerStrategy } from "../locator/strategies/dom-tracer.js";
import { evaluateGates, filterByAction } from "./gates.js";
// Metrics can be calculated from iterationHistory using calculateLoopMetrics if needed
import { DEFAULT_GATE_CONFIG, DEFAULT_LOOP_OPTIONS, LoopError } from "./types.js";
import { verifyChanges } from "./verify.js";

// ═══════════════════════════════════════════════════════════════════════════
// Error Construction
// ═══════════════════════════════════════════════════════════════════════════

function makeError(phase: LoopError["phase"], detail: string, cause?: unknown): LoopError {
  return new LoopError({ phase, detail, cause });
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type LoopCaptureResult = {
  state: PipelineState;
  issues: Issue[];
};

export type LocateResult = {
  issuesWithLocations: Array<{ issue: Issue; locations: readonly CodeLocation[] }>;
};

/**
 * Callbacks for pipeline operations.
 * These abstract the actual capture/analyze/fix implementations.
 */
export type LoopCallbacks = {
  /** Capture screenshot and analyze for issues */
  capture: (
    url: string,
    viewport: ViewportConfig,
  ) => Effect.Effect<LoopCaptureResult, LoopError, FileSystem.FileSystem>;

  /** Apply a fix to the codebase */
  applyFix: (
    issue: Issue,
    location: CodeLocation,
    decision: GateDecision,
  ) => Effect.Effect<AppliedFix, LoopError>;

  /** Prompt human for review decision */
  promptHuman: (
    issue: Issue,
    locations: readonly CodeLocation[],
    decision: GateDecision,
  ) => Effect.Effect<HumanResponse, LoopError>;

  /** Called when iteration completes */
  onIterationComplete?: (state: IterationState) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

export class LoopOrchestrator {
  private readonly options: Required<LoopOptions>;
  private readonly gateConfig: GateConfig;
  private readonly callbacks: LoopCallbacks;
  private readonly resolver = createResolverWithStrategies([domTracerStrategy]);

  constructor(
    options: LoopOptions,
    callbacks: LoopCallbacks,
    gateConfig: Partial<GateConfig> = {},
  ) {
    this.options = { ...DEFAULT_LOOP_OPTIONS, ...options } as Required<LoopOptions>;
    this.gateConfig = { ...DEFAULT_GATE_CONFIG, ...gateConfig };
    this.callbacks = callbacks;
  }

  /**
   * Run the main feedback loop.
   */
  run(): Effect.Effect<LoopResult, LoopError, FileSystem.FileSystem> {
    return Effect.gen(this, function* () {
      const startedAt = new Date().toISOString();
      const iterationHistory: IterationState[] = [];
      let baseline: PipelineState | null = null;
      let status: LoopStatus = "running";
      let initialIssueCount = 0;

      for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
        const iterationStartedAt = new Date().toISOString();

        // 1. CAPTURE & ANALYZE
        const viewport = this.options.viewports[0];
        if (viewport === undefined) {
          return yield* makeError("capture", "No viewport configured");
        }

        const captureResult = yield* this.callbacks.capture(this.options.url, viewport);
        const currentState = captureResult.state;
        const issues = captureResult.issues;

        if (iteration === 0) {
          initialIssueCount = issues.length;
        }

        if (issues.length === 0) {
          status = "completed-resolved";
          const iterationState = this.createIterationState(
            iteration,
            iterationStartedAt,
            currentState,
            issues,
            [],
          );
          iterationHistory.push(iterationState);
          this.callbacks.onIterationComplete?.(iterationState);
          break;
        }

        // 2. LOCATE code for issues
        // Extract DOM snapshot from pipeline state artifacts
        const domSnapshotArtifact = Object.values(currentState.artifacts).find(
          (a) => a.type === "dom-snapshot",
        );
        const domSnapshotPath = domSnapshotArtifact?.path;
        let domSnapshot: DOMSnapshot | undefined;

        if (domSnapshotPath !== undefined) {
          const domResult = yield* Effect.tryPromise({
            try: async () => loadDOMSnapshotFromPath(domSnapshotPath),
            catch: (e: unknown) =>
              makeError(
                "locate",
                `Failed to load DOM snapshot: ${e instanceof Error ? e.message : String(e)}`,
              ),
          });
          if (domResult.snapshot !== undefined && domResult.snapshot !== null) {
            domSnapshot = domResult.snapshot;
          } else if (domResult.error !== undefined && domResult.error.length > 0) {
            console.warn(`DOM snapshot: ${domResult.error}`);
          }
        }

        const locatorCtx: LocatorContext = {
          projectRoot: this.options.projectRoot,
          domSnapshot,
          filePatterns: DEFAULT_FILE_PATTERNS,
        };

        const locateResult = yield* this.resolver
          .locateAll(issues, locatorCtx)
          .pipe(Effect.mapError((e) => makeError("locate", e.message, e)));

        const issuesWithLocations = locateResult.results.map((r) => ({
          issue: r.issue,
          locations: r.locations,
        }));

        // 3. GATE decisions
        const decisions = evaluateGates(issuesWithLocations, this.gateConfig);
        const autoFixes = filterByAction(decisions, "auto-fix");
        const humanReviews = filterByAction(decisions, "human-review");

        // 4. FIX
        const fixesApplied: AppliedFix[] = [];

        for (const decision of autoFixes) {
          if (decision.location !== undefined) {
            const fix = yield* this.callbacks.applyFix(decision.issue, decision.location, decision);
            fixesApplied.push(fix);
          }
        }

        if (this.options.interactive && humanReviews.length > 0) {
          for (const decision of humanReviews) {
            const locations =
              issuesWithLocations.find((i) => i.issue.id === decision.issue.id)?.locations ?? [];

            const response = yield* this.callbacks.promptHuman(decision.issue, locations, decision);

            if (response.action === "abort") {
              status = "aborted";
              break;
            }

            if (response.action === "apply" && response.location !== undefined) {
              const fix = yield* this.callbacks.applyFix(
                decision.issue,
                response.location,
                decision,
              );
              fixesApplied.push(fix);
            }
          }

          if (status === "aborted") {
            const iterationState = this.createIterationState(
              iteration,
              iterationStartedAt,
              currentState,
              issues,
              fixesApplied,
            );
            iterationHistory.push(iterationState);
            break;
          }
        }

        // 5. VERIFY
        let verification: VerificationResult | undefined;
        if (baseline !== null) {
          verification = yield* verifyChanges(baseline, currentState).pipe(
            Effect.mapError((e) => makeError("verify", e.message, e)),
          );

          if (verification.verdict === "regressed") {
            console.warn(`Regression detected: ${verification.introduced.length} new issues`);
          }

          // No improvement after fix attempts.
          // In dry-run mode, treat "applied" fixes as simulated/no-op, so unchanged should stop the loop.
          if (
            verification.verdict === "unchanged" &&
            (fixesApplied.length === 0 || this.options.dryRun)
          ) {
            status = "completed-no-improvement";
            const iterationState = this.createIterationState(
              iteration,
              iterationStartedAt,
              currentState,
              issues,
              fixesApplied,
              verification,
            );
            iterationHistory.push(iterationState);
            this.callbacks.onIterationComplete?.(iterationState);
            break;
          }
        }

        const iterationState = this.createIterationState(
          iteration,
          iterationStartedAt,
          currentState,
          issues,
          fixesApplied,
          verification,
        );
        iterationHistory.push(iterationState);
        this.callbacks.onIterationComplete?.(iterationState);

        baseline = currentState;
      }

      if (status === "running") {
        status = "completed-max-iterations";
      }

      const finalIssues = iterationHistory.at(-1)?.issuesFound ?? [];

      return {
        status,
        iterations: iterationHistory.length,
        sessionDir: this.options.sessionDir ?? "",
        startedAt,
        completedAt: new Date().toISOString(),
        initialIssueCount,
        finalIssueCount: finalIssues.length,
        totalFixesApplied: iterationHistory.reduce((sum, i) => sum + i.fixesApplied.length, 0),
        iterationHistory,
        finalVerification: iterationHistory.at(-1)?.verification,
      };
    });
  }

  private createIterationState(
    number: number,
    startedAt: string,
    pipelineState: PipelineState,
    issuesFound: Issue[],
    fixesApplied: AppliedFix[],
    verification?: IterationState["verification"],
  ): IterationState {
    return {
      number,
      startedAt,
      completedAt: new Date().toISOString(),
      pipelineState,
      issuesFound,
      fixesApplied,
      verification,
    };
  }
}

/**
 * Create and run a loop with the given options.
 */
export function runLoop(
  options: LoopOptions,
  callbacks: LoopCallbacks,
  gateConfig?: Partial<GateConfig>,
): Effect.Effect<LoopResult, LoopError, FileSystem.FileSystem> {
  const orchestrator = new LoopOrchestrator(options, callbacks, gateConfig);
  return orchestrator.run();
}
