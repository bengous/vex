/**
 * loop command - Run iterative improvement loop on a URL.
 *
 * Usage: vex loop <url> [options]
 *
 * Options:
 *   --max-iterations <n>  Maximum iterations (default: 5)
 *   --device <name>       Device preset (e.g., iphone-15-pro, desktop-1920)
 *   --viewport <WxH>      Viewport size (default: 1920x1080)
 *   --list-devices        List available device presets
 *   --interactive         Enable human-in-the-loop review (Phase 2+)
 *   --auto-fix <level>    Auto-fix threshold: high, medium, none (default: high)
 *   --output <dir>        Session output directory (overrides VEX_OUTPUT_DIR/.vexrc.json)
 *   --dry-run             Run without applying code changes (default in Phase 1)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { loadConfig, VexConfigError } from '../../core/config.js';
import { getAllDeviceIds, listDevices, lookupDevice } from '../../core/devices.js';
import type { CodeLocation, Issue, ViewportConfig } from '../../core/types.js';
import { type LoopCallbacks, type LoopCaptureResult, LoopOrchestrator } from '../../loop/orchestrator.js';
import type {
  AppliedFix,
  AutoFixThreshold,
  GateDecision,
  HumanResponse,
  LoopError,
  LoopOptions,
  LoopResult,
} from '../../loop/types.js';
import { generateSessionId, runPipeline, simpleAnalysis } from '../../pipeline/index.js';
// Import providers for self-registration
import '../../providers/index.js';

const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

function parseViewport(input: string): ViewportConfig {
  const match = input.match(/^(\d+)x(\d+)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid viewport format: ${input}. Use WxH format (e.g., 1920x1080)`);
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
    deviceScaleFactor: 1,
    isMobile: false,
  };
}

interface ParsedOptions {
  url: string;
  maxIterations: number;
  interactive: boolean;
  autoFixThreshold: AutoFixThreshold;
  viewports: readonly ViewportConfig[];
  provider: string;
  model?: string;
  outputDir?: string; // --output flag value (before resolution)
  projectRoot: string;
  dryRun: boolean;
}

function parseOptions(args: string[]): ParsedOptions | 'list-devices' {
  const { values, positionals } = parseArgs({
    args,
    options: {
      'max-iterations': { type: 'string', short: 'n' },
      device: { type: 'string', short: 'd' },
      viewport: { type: 'string', short: 'V' },
      'list-devices': { type: 'boolean' },
      interactive: { type: 'boolean', short: 'i' },
      'auto-fix': { type: 'string' },
      output: { type: 'string', short: 'o' },
      'dry-run': { type: 'boolean', short: 'D' },
      provider: { type: 'string', short: 'p' },
      project: { type: 'string', short: 'P' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values['list-devices']) {
    return 'list-devices';
  }

  if (values.help) {
    console.log(`
Usage: vex loop <url> [options]

Options:
  --max-iterations, -n <n>  Maximum iterations (default: 5)
  --device, -d <name>       Device preset (e.g., iphone-15-pro, desktop-1920)
  --viewport, -V <WxH>      Viewport size (default: 1920x1080)
  --list-devices            List available device presets
  --interactive, -i         Enable human-in-the-loop review (Phase 2+, ignored in Phase 1)
  --auto-fix <level>        Auto-fix threshold: high, medium, none (default: high)
  --output, -o <dir>        Session output directory (overrides VEX_OUTPUT_DIR/.vexrc.json)
  --dry-run, -D             Run without applying code changes (default in Phase 1)
  --provider, -p <name>     VLM provider (default: ollama)
  --project, -P <dir>       Project root for code search (required)
  --help, -h                Show this help

Configuration:
  Set output directory via:
  - --output flag (highest priority)
  - VEX_OUTPUT_DIR environment variable
  - outputDir in .vexrc.json
`);
    process.exit(0);
  }

  const url = positionals[0];
  if (!url) {
    throw new Error('URL is required. Usage: vex loop <url>');
  }

  // Priority: --device > --viewport > default
  let viewport = DEFAULT_VIEWPORT;
  if (values.device) {
    const result = lookupDevice(values.device);
    if (!result) {
      const available = getAllDeviceIds().join(', ');
      throw new Error(
        `Unknown device "${values.device}".\n\nAvailable devices: ${available}\n\nRun 'vex loop --list-devices' for full list.`,
      );
    }
    viewport = result.preset.viewport;
  } else if (values.viewport) {
    viewport = parseViewport(values.viewport);
  }

  const autoFixThreshold = (values['auto-fix'] ?? 'high') as AutoFixThreshold;
  if (!['high', 'medium', 'none'].includes(autoFixThreshold)) {
    throw new Error('Invalid auto-fix threshold. Use: high, medium, or none');
  }

  const projectRoot = values.project;
  if (!projectRoot) {
    throw new Error('--project is required. Specify the repository root to search for code.');
  }

  return {
    url,
    maxIterations: values['max-iterations'] ? Number.parseInt(values['max-iterations'], 10) : 5,
    interactive: values.interactive ?? false,
    autoFixThreshold,
    viewports: [viewport],
    provider: values.provider ?? 'ollama',
    outputDir: values.output,
    projectRoot,
    dryRun: values['dry-run'] ?? false,
  };
}

/**
 * Resolve output directory using the same priority as scan command:
 * 1. --output flag (highest priority)
 * 2. VEX_OUTPUT_DIR environment variable
 * 3. outputDir in .vexrc.json
 */
function resolveOutputDir(outputFlag?: string): string {
  if (outputFlag) {
    return outputFlag;
  }

  try {
    const config = loadConfig();
    return config.outputDir;
  } catch (e) {
    if (e instanceof VexConfigError) {
      throw new Error(`${e.message}\n\nOr use --output <dir> to specify directly.`);
    }
    throw e;
  }
}

function makeLoopError(phase: LoopError['phase'], message: string, cause?: unknown): LoopError {
  return { _tag: 'LoopError', phase, message, cause };
}

/**
 * Create capture callback that runs the pipeline for each iteration.
 *
 * Directory structure (flat, no double-nesting):
 * ```
 * loop-<id>/
 *   <timestamp-1>/    ← iteration 0 (created by pipeline)
 *   <timestamp-2>/    ← iteration 1 (created by pipeline)
 *   iterations.json
 *   state.json
 * ```
 *
 * Each pipeline session directory IS the iteration directory.
 */
function createCaptureCallback(loopSessionDir: string, provider: string, model?: string): LoopCallbacks['capture'] {
  return (url, viewport) =>
    Effect.gen(function* () {
      // runPipeline creates its own session directory inside loopSessionDir
      // Each pipeline session becomes one iteration
      const pipeline = simpleAnalysis(url, viewport, provider, model);
      const state = yield* runPipeline(pipeline, loopSessionDir).pipe(
        Effect.mapError((e) => makeLoopError('capture', e.message, e)),
      );

      return { state, issues: state.issues } satisfies LoopCaptureResult;
    });
}

/**
 * Phase 1: Dry-run applyFix - logs but doesn't modify files.
 */
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

/**
 * Phase 1: Dry-run promptHuman - always skips (no interactive mode yet).
 */
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

async function saveIterationHistory(sessionDir: string, result: LoopResult, options: LoopOptions): Promise<void> {
  const historyFile = {
    sessionId: sessionDir.split('/').pop(),
    url: options.url,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    status: result.status,
    phase: 1, // Track implementation phase
    dryRun: true, // Phase 1 is always dry-run
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
      sessionDir: iter.pipelineState.sessionDir, // Flat: each pipeline session IS the iteration
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

  // Compatibility: allow `vex verify <loop-session>` by writing a minimal state.json with iterationHistory.
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

export async function loopCommand(args: string[]): Promise<void> {
  const parsed = parseOptions(args);

  if (parsed === 'list-devices') {
    listDevices();
    return;
  }

  // Resolve output directory (respects VEX_OUTPUT_DIR/.vexrc.json like scan command)
  const baseDir = resolveOutputDir(parsed.outputDir);

  // Create loop session directory
  const sessionId = `loop-${generateSessionId()}`;
  const sessionDir = join(baseDir, sessionId);
  await mkdir(sessionDir, { recursive: true });

  // Phase 1: Force dry-run and disable interactive mode
  // These features will be enabled in Phase 2/3
  const loopOptions: LoopOptions = {
    url: parsed.url,
    maxIterations: parsed.maxIterations,
    interactive: false, // Phase 1: always disabled
    autoFixThreshold: parsed.autoFixThreshold,
    viewports: parsed.viewports,
    provider: parsed.provider,
    model: parsed.model,
    sessionDir,
    projectRoot: parsed.projectRoot,
    dryRun: true, // Phase 1: always dry-run
  };

  // Print configuration
  console.log(`Starting improvement loop for ${loopOptions.url}`);
  console.log(`Max iterations: ${loopOptions.maxIterations}`);
  console.log(`Auto-fix threshold: ${loopOptions.autoFixThreshold}`);
  console.log(`Provider: ${loopOptions.provider}`);
  console.log('');
  console.log('[Phase 1] Dry-run mode: applyFix disabled (no code changes)');
  console.log('[Phase 1] Interactive mode: disabled (promptHuman returns skip)');
  if (parsed.interactive) {
    console.log('         (--interactive flag ignored until Phase 2)');
  }
  if (parsed.dryRun === false) {
    console.log('         (--dry-run=false ignored until Phase 3)');
  }

  const callbacks: LoopCallbacks = {
    capture: createCaptureCallback(sessionDir, loopOptions.provider, loopOptions.model),
    applyFix: createDryRunApplyFix(),
    promptHuman: createDryRunPromptHuman(),
    onIterationComplete: createIterationLogger(),
  };

  const orchestrator = new LoopOrchestrator(loopOptions, callbacks);

  let result: LoopResult;
  try {
    result = await Effect.runPromise(orchestrator.run());
  } catch (err) {
    if (typeof err === 'object' && err !== null && '_tag' in err && (err as { _tag?: unknown })._tag === 'LoopError') {
      const e = err as LoopError;
      console.error(`\nLoop failed at ${e.phase}: ${e.message}`);
    } else {
      console.error('\nLoop failed:', err);
    }
    process.exit(1);
  }

  await saveIterationHistory(sessionDir, result, loopOptions);
  printLoopSummary(result);
}
