/**
 * verify command - Compare iterations in a session and show verification.
 *
 * Usage: vex verify <session> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import type { PipelineState } from "../../pipeline/types.js";
import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyChanges } from "../../loop/verify.js";
import { baselineOption, currentOption, jsonOption } from "../options.js";

// ═══════════════════════════════════════════════════════════════════════════
// Session Argument
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Session directory positional argument.
 */
const sessionArg = Args.directory({ name: "session" });

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function loadIterationState(sessionDir: string, iteration: number | "latest"): PipelineState {
  const statePath = join(sessionDir, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, "utf-8")) as unknown;
  const stateObject =
    typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};

  if (Array.isArray(stateObject.iterationHistory)) {
    const idx = iteration === "latest" ? stateObject.iterationHistory.length - 1 : iteration;
    const iterState = stateObject.iterationHistory[idx] as
      | { readonly pipelineState?: PipelineState }
      | undefined;
    if (iterState?.pipelineState === undefined) {
      throw new Error(`Iteration ${iteration} not found`);
    }
    return iterState.pipelineState;
  }

  // Otherwise use the main state
  return state as PipelineState;
}

// ═══════════════════════════════════════════════════════════════════════════
// Verify Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify command implementation.
 */
export const verifyCommand = Command.make(
  "verify",
  {
    session: sessionArg,
    baseline: baselineOption,
    current: currentOption,
    json: jsonOption,
  },
  (args) =>
    Effect.gen(function* () {
      const sessionDir = args.session;

      if (!existsSync(sessionDir)) {
        console.error(`Session not found: ${sessionDir}`);
        return;
      }

      const baselineIteration = Option.getOrElse(args.baseline, () => 0);
      const currentIteration: number | "latest" = Option.getOrElse(
        args.current,
        () => "latest" as const,
      );

      console.log(`Verifying session ${sessionDir}`);
      console.log(`Baseline: iteration ${baselineIteration}`);
      console.log(`Current: iteration ${currentIteration}`);

      const baseline = loadIterationState(sessionDir, baselineIteration);
      const current = loadIterationState(sessionDir, currentIteration);

      const result = yield* verifyChanges(baseline, current);

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\nVerdict: ${result.verdict.toUpperCase()}`);
        console.log(`\nResolved: ${result.resolved.length}`);
        for (const issue of result.resolved) {
          console.log(`  - [${issue.severity}] ${issue.description}`);
        }

        console.log(`\nIntroduced: ${result.introduced.length}`);
        for (const issue of result.introduced) {
          console.log(`  - [${issue.severity}] ${issue.description}`);
        }

        console.log(`\nUnchanged: ${result.unchanged.length}`);

        console.log("\nMetrics:");
        console.log(`  Baseline issues: ${result.metrics.baselineIssueCount}`);
        console.log(`  Current issues: ${result.metrics.currentIssueCount}`);
        console.log(`  Improvement: ${result.metrics.improvementPercent}%`);
      }
    }),
).pipe(Command.withDescription("Compare iterations in a session and show verification"));
