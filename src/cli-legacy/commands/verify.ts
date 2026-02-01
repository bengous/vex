/**
 * verify command - Compare iterations in a session and show verification.
 *
 * Usage: vex verify <session> [options]
 *
 * Options:
 *   --baseline <n>    Baseline iteration number (default: 0)
 *   --current <n>     Current iteration number (default: latest)
 *   --json            Output results as JSON
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { verifyChanges } from '../../loop/verify.js';
import type { PipelineState } from '../../pipeline/types.js';

interface VerifyOptions {
  sessionDir: string;
  baselineIteration: number;
  currentIteration: number | 'latest';
  json: boolean;
}

function parseOptions(args: string[]): VerifyOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      baseline: { type: 'string', short: 'b' },
      current: { type: 'string', short: 'c' },
      json: { type: 'boolean', short: 'j' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: vex verify <session> [options]

Options:
  --baseline, -b <n>   Baseline iteration number (default: 0)
  --current, -c <n>    Current iteration number (default: latest)
  --json, -j           Output results as JSON
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const sessionDir = positionals[0];
  if (!sessionDir) {
    throw new Error('Session directory is required. Usage: vex verify <session>');
  }

  if (!existsSync(sessionDir)) {
    throw new Error(`Session not found: ${sessionDir}`);
  }

  return {
    sessionDir,
    baselineIteration: values.baseline ? Number.parseInt(values.baseline, 10) : 0,
    currentIteration: values.current ? Number.parseInt(values.current, 10) : 'latest',
    json: values.json ?? false,
  };
}

function loadIterationState(sessionDir: string, iteration: number | 'latest'): PipelineState {
  const statePath = join(sessionDir, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));

  // If session has iteration history, use that
  if (state.iterationHistory && Array.isArray(state.iterationHistory)) {
    const idx = iteration === 'latest' ? state.iterationHistory.length - 1 : iteration;
    const iterState = state.iterationHistory[idx];
    if (!iterState) {
      throw new Error(`Iteration ${iteration} not found`);
    }
    return iterState.pipelineState;
  }

  // Otherwise use the main state
  return state as PipelineState;
}

export async function verifyCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  console.log(`Verifying session ${options.sessionDir}`);
  console.log(`Baseline: iteration ${options.baselineIteration}`);
  console.log(`Current: iteration ${options.currentIteration}`);

  const baseline = loadIterationState(options.sessionDir, options.baselineIteration);
  const current = loadIterationState(options.sessionDir, options.currentIteration);

  const result = await Effect.runPromise(verifyChanges(baseline, current));

  if (options.json) {
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

    console.log('\nMetrics:');
    console.log(`  Baseline issues: ${result.metrics.baselineIssueCount}`);
    console.log(`  Current issues: ${result.metrics.currentIssueCount}`);
    console.log(`  Improvement: ${result.metrics.improvementPercent}%`);
  }
}
