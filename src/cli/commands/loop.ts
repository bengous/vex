/**
 * loop command - Run iterative improvement loop on a URL.
 *
 * Usage: vex loop <url> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Args, Command } from '@effect/cli';
import { Effect } from 'effect';
import { Url } from '../../config/schema.js';
import { getAllDeviceIds, listDevices, lookupDevice } from '../../core/devices.js';
import type { CodeLocation, Issue, ViewportConfig } from '../../core/types.js';
import { type LoopCallbacks, type LoopCaptureResult, LoopOrchestrator } from '../../loop/orchestrator.js';
import {
  type AppliedFix,
  type GateConfig,
  type GateDecision,
  type HumanResponse,
  LoopError,
  type LoopOptions,
  type LoopResult,
} from '../../loop/types.js';
import { simpleAnalysis } from '../../pipeline/presets.js';
import { runPipeline } from '../../pipeline/runtime.js';
import { generateSessionId } from '../../pipeline/state.js';
import { withProviderExecution } from '../../providers/shared/profile-execution.js';
import {
  autoFixOption,
  deviceOption,
  dryRunOption,
  interactiveOption,
  listDevicesOption,
  maxIterationsOption,
  modelOption,
  outputOption,
  placeholderMediaOption,
  presetOption,
  projectOption,
  providerOption,
  providerProfileOption,
} from '../options.js';
import type { LoopCliArgs, ResolvedFullPageScrollFix, ResolvedPlaceholderMedia } from '../resolve.js';
import { resolveLoopOptions } from '../resolve.js';

// ═══════════════════════════════════════════════════════════════════════════
// URL Argument
// ═══════════════════════════════════════════════════════════════════════════

const urlArg = Args.text({ name: 'url' }).pipe(Args.withSchema(Url), Args.optional);

// ═══════════════════════════════════════════════════════════════════════════
// Loop Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeLoopError(phase: LoopError['phase'], detail: string, cause?: unknown): LoopError {
  return new LoopError({ phase, detail, cause });
}

function createCaptureCallback(
  loopSessionDir: string,
  provider: string,
  model?: string,
  placeholderMedia?: ResolvedPlaceholderMedia,
  fullPageScrollFix?: ResolvedFullPageScrollFix,
): LoopCallbacks['capture'] {
  return (url, viewport) =>
    Effect.gen(function* () {
      const pipeline = simpleAnalysis(url, viewport, provider, model, undefined, placeholderMedia, fullPageScrollFix);
      const state = yield* runPipeline(pipeline, loopSessionDir).pipe(
        Effect.mapError((e) => makeLoopError('capture', e.message, e)),
      );
      return { state, issues: state.issues } satisfies LoopCaptureResult;
    });
}

function createDryRunApplyFix(): LoopCallbacks['applyFix'] {
  return (issue: Issue, location: CodeLocation, _decision: GateDecision) =>
    Effect.succeed({
      issue,
      location,
      action: 'auto',
      timestamp: new Date().toISOString(),
      diff: '[Phase 1: dry-run, no changes applied]',
    } satisfies AppliedFix);
}

function createDryRunPromptHuman(): LoopCallbacks['promptHuman'] {
  return (_issue: Issue, _locations: readonly CodeLocation[], _decision: GateDecision) =>
    Effect.succeed({ action: 'skip' } satisfies HumanResponse);
}

function createIterationLogger(): LoopCallbacks['onIterationComplete'] {
  return (state) => {
    console.log(`\n--- Iteration ${state.number} Complete ---`);
    console.log(`Session: ${state.pipelineState.sessionDir}`);
    console.log(`Issues found: ${state.issuesFound.length}`);
    if (state.fixesApplied.length > 0) {
      console.log(`Fixes applied: ${state.fixesApplied.length} (simulated)`);
    }
    if (state.verification) {
      console.log(`Verification: ${state.verification.verdict}`);
      console.log(`  Resolved: ${state.verification.resolved.length}`);
      console.log(`  Introduced: ${state.verification.introduced.length}`);
      console.log(`  Unchanged: ${state.verification.unchanged.length}`);
    }
  };
}

export function createGateConfigFromLoopOptions(options: LoopOptions): Pick<GateConfig, 'autoFixConfidence'> {
  return {
    autoFixConfidence: options.autoFixThreshold,
  };
}

async function saveIterationHistory(sessionDir: string, result: LoopResult, options: LoopOptions): Promise<void> {
  const historyFile = {
    sessionId: sessionDir.split('/').pop(),
    url: options.url,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    status: result.status,
    phase: 1,
    dryRun: true,
    summary: {
      initialIssueCount: result.initialIssueCount,
      finalIssueCount: result.finalIssueCount,
      totalIterations: result.iterations,
      totalFixesApplied: result.totalFixesApplied,
    },
    iterations: result.iterationHistory.map((iter) => ({
      number: iter.number,
      startedAt: iter.startedAt,
      completedAt: iter.completedAt,
      sessionDir: iter.pipelineState.sessionDir,
      issueCount: iter.issuesFound.length,
      fixCount: iter.fixesApplied.length,
      verification: iter.verification
        ? {
            verdict: iter.verification.verdict,
            resolved: iter.verification.resolved.length,
            introduced: iter.verification.introduced.length,
            unchanged: iter.verification.unchanged.length,
          }
        : undefined,
    })),
  };

  await writeFile(join(sessionDir, 'iterations.json'), JSON.stringify(historyFile, null, 2), 'utf-8');
  await writeFile(
    join(sessionDir, 'state.json'),
    JSON.stringify(
      {
        type: 'vex-loop',
        phase: 1,
        url: options.url,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        status: result.status,
        iterationHistory: result.iterationHistory,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function printLoopSummary(result: LoopResult): void {
  console.log('\n=== Loop Complete ===');
  console.log(`Status: ${result.status}`);
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Issues: ${result.initialIssueCount} → ${result.finalIssueCount} (dry-run)`);
  if (result.totalFixesApplied > 0) {
    console.log(`Fixes applied: ${result.totalFixesApplied} (simulated)`);
  }
  if (result.finalVerification) {
    console.log(`Final verdict: ${result.finalVerification.verdict}`);
  }
  console.log(`Session: ${result.sessionDir}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop Command
// ═══════════════════════════════════════════════════════════════════════════

export const loopCommand = Command.make(
  'loop',
  {
    url: urlArg,
    preset: presetOption,
    device: deviceOption,
    provider: providerOption,
    model: modelOption,
    providerProfile: providerProfileOption,
    maxIterations: maxIterationsOption,
    autoFix: autoFixOption,
    project: projectOption,
    dryRun: dryRunOption,
    placeholderMedia: placeholderMediaOption,
    output: outputOption,
    listDevices: listDevicesOption,
    interactive: interactiveOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.listDevices) {
        listDevices();
        return;
      }

      const cliArgs: LoopCliArgs = {
        url: args.url,
        preset: args.preset,
        device: args.device,
        provider: args.provider,
        model: args.model,
        providerProfile: args.providerProfile,
        maxIterations: args.maxIterations,
        autoFix: args.autoFix,
        dryRun: args.dryRun,
        placeholderMedia: args.placeholderMedia,
        output: args.output,
        project: args.project,
      };

      const resolved = yield* resolveLoopOptions(cliArgs);

      const deviceResult = lookupDevice(resolved.devices[0] as string);
      if (!deviceResult) {
        const validDevices = getAllDeviceIds().join(', ');
        return yield* Effect.fail(
          new Error(`Unknown device: ${resolved.devices[0]}.
Use explicit device IDs (e.g., iphone-se-2016 or iphone-se-2022).
Valid devices: ${validDevices}`),
        );
      }
      const viewport: ViewportConfig = deviceResult.preset.viewport;

      const sessionId = `loop-${generateSessionId()}`;
      const sessionDir = join(resolved.outputDir, sessionId);
      yield* Effect.promise(() => mkdir(sessionDir, { recursive: true }));

      // Phase 1: Force dry-run and disable interactive mode
      const loopOptions: LoopOptions = {
        url: resolved.urls[0] as string,
        maxIterations: resolved.maxIterations,
        interactive: false, // Phase 1: always disabled
        autoFixThreshold: resolved.autoFix,
        viewports: [viewport],
        provider: resolved.provider,
        model: resolved.model,
        sessionDir,
        projectRoot: resolved.projectRoot,
        dryRun: true, // Phase 1: always dry-run
      };

      console.log(`Starting improvement loop for ${loopOptions.url}`);
      console.log(`Max iterations: ${loopOptions.maxIterations}`);
      console.log(`Auto-fix threshold: ${loopOptions.autoFixThreshold}`);
      console.log(
        `Provider: ${loopOptions.provider}${resolved.model ? ` (model: ${resolved.model})` : ''}${resolved.profile !== 'minimal' ? ` (profile: ${resolved.profile})` : ''}`,
      );
      console.log(`Viewport: ${viewport.width}x${viewport.height} (${resolved.devices[0]})`);
      if (resolved.placeholderMedia) {
        console.log('Placeholder media: enabled');
      }
      if (resolved.fullPageScrollFix) {
        console.log('Full-page scroll fix: enabled');
      }
      console.log('');
      console.log('[Phase 1] Dry-run mode: applyFix disabled (no code changes)');
      console.log('[Phase 1] Interactive mode: disabled (promptHuman returns skip)');
      if (args.interactive) {
        console.log('         (--interactive flag ignored until Phase 2)');
      }
      if (!args.dryRun) {
        console.log('         (--dry-run=false ignored until Phase 3)');
      }

      const callbacks: LoopCallbacks = {
        capture: createCaptureCallback(
          sessionDir,
          loopOptions.provider,
          loopOptions.model,
          resolved.placeholderMedia,
          resolved.fullPageScrollFix,
        ),
        applyFix: createDryRunApplyFix(),
        promptHuman: createDryRunPromptHuman(),
        onIterationComplete: createIterationLogger(),
      };

      const orchestrator = new LoopOrchestrator(
        loopOptions,
        callbacks,
        createGateConfigFromLoopOptions(loopOptions),
      );

      const runOrchestrator = orchestrator.run().pipe(
        Effect.catchAll((err) => {
          if (err instanceof LoopError) {
            console.error(`\nLoop failed at ${err.phase}: ${err.message}`);
          } else {
            console.error('\nLoop failed:', err);
          }
          return Effect.fail(err);
        }),
      );

      const result = yield* withProviderExecution(
        { provider: resolved.provider, profile: resolved.profile },
        runOrchestrator,
      );

      yield* Effect.promise(() => saveIterationHistory(sessionDir, result, loopOptions));
      printLoopSummary(result);
    }),
).pipe(Command.withDescription('Run iterative improvement loop on a URL'));
