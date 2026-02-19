/**
 * locate command - Find code locations for issues in a session.
 *
 * Usage: vex locate <session> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Args, Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { loadDOMSnapshot } from '../../core/dom-snapshot-loader.js';
import type { Issue } from '../../core/types.js';
import { createResolverWithStrategies } from '../../locator/resolver.js';
import { domTracerStrategy } from '../../locator/strategies/dom-tracer.js';
import type { LocatorContext } from '../../locator/types.js';
import { jsonOption, patternsOption, projectOption } from '../options.js';

// ═══════════════════════════════════════════════════════════════════════════
// Session Directory Argument
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Session directory positional argument.
 */
const sessionArg = Args.directory({ name: 'session' });

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type JsonObject = Record<string, unknown>;

interface AnalysisArtifactRef {
  readonly type?: string;
  readonly path?: string;
}

export interface LocateSessionContext {
  readonly issues: Issue[];
  readonly domSessionDir: string;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : undefined;
}

function loadIssuesFromAnalysisArtifacts(artifacts: Record<string, AnalysisArtifactRef> | undefined): Issue[] {
  const analysisArtifact = artifacts ? Object.values(artifacts).find((a) => a.type === 'analysis') : undefined;
  if (!analysisArtifact?.path || !existsSync(analysisArtifact.path)) {
    return [];
  }

  try {
    const analysis = JSON.parse(readFileSync(analysisArtifact.path, 'utf-8')) as { issues?: unknown };
    return Array.isArray(analysis.issues) ? (analysis.issues as Issue[]) : [];
  } catch {
    return [];
  }
}

export function loadLocateSessionContext(sessionDir: string): LocateSessionContext {
  const statePath = join(sessionDir, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8')) as unknown;
  const stateObj = asObject(state);
  if (!stateObj) {
    return { issues: [], domSessionDir: sessionDir };
  }

  let domSessionDir = sessionDir;

  if (stateObj.type === 'vex-loop') {
    const iterations = Array.isArray(stateObj.iterationHistory) ? stateObj.iterationHistory : [];
    const latestIteration = asObject(iterations.at(-1));
    const latestPipelineState = asObject(latestIteration?.pipelineState);

    if (typeof latestPipelineState?.sessionDir === 'string') {
      domSessionDir = latestPipelineState.sessionDir;
    }

    const loopIssues = latestIteration?.issuesFound;
    if (Array.isArray(loopIssues) && loopIssues.length > 0) {
      return { issues: loopIssues as Issue[], domSessionDir };
    }

    const pipelineIssues = latestPipelineState?.issues;
    if (Array.isArray(pipelineIssues) && pipelineIssues.length > 0) {
      return { issues: pipelineIssues as Issue[], domSessionDir };
    }

    const latestPipelineArtifacts = asObject(latestPipelineState?.artifacts) as Record<string, AnalysisArtifactRef> | undefined;
    const latestPipelineAnalysisIssues = loadIssuesFromAnalysisArtifacts(latestPipelineArtifacts);
    if (latestPipelineAnalysisIssues.length > 0) {
      return { issues: latestPipelineAnalysisIssues, domSessionDir };
    }
  }

  if (Array.isArray(stateObj.issues) && stateObj.issues.length > 0) {
    return { issues: stateObj.issues as Issue[], domSessionDir };
  }

  const rootArtifacts = asObject(stateObj.artifacts) as Record<string, AnalysisArtifactRef> | undefined;
  return { issues: loadIssuesFromAnalysisArtifacts(rootArtifacts), domSessionDir };
}

// ═══════════════════════════════════════════════════════════════════════════
// Locate Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Locate command implementation.
 */
export const locateCommand = Command.make(
  'locate',
  {
    session: sessionArg,
    project: projectOption,
    patterns: patternsOption,
    json: jsonOption,
  },
  (args) =>
    Effect.gen(function* () {
      const sessionDir = args.session;
      const projectRoot = args.project;
      const patternsStr = Option.getOrUndefined(args.patterns);
      const filePatterns = patternsStr ? patternsStr.split(',') : ['*.liquid', '*.css', '*.scss'];
      const jsonOutput = args.json;

      console.log(`Loading session from ${sessionDir}`);
      console.log(`Searching in ${projectRoot}`);

      const { issues, domSessionDir } = loadLocateSessionContext(sessionDir);
      console.log(`Found ${issues.length} issues to locate`);

      if (issues.length === 0) {
        console.log('No issues to locate');
        return;
      }

      // Load DOM snapshot from pipeline session (for vex-loop, this is the latest iteration session)
      const domResult = yield* Effect.promise(() => loadDOMSnapshot(domSessionDir));
      if (domResult.error) {
        console.warn(`DOM: ${domResult.error}`);
      }

      const resolver = createResolverWithStrategies([domTracerStrategy]);
      const ctx: LocatorContext = {
        projectRoot,
        filePatterns,
        domSnapshot: domResult.snapshot ?? undefined,
      };

      const result = yield* resolver.locateAll(issues, ctx);

      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\nLocated ${result.summary.issuesWithLocations}/${result.summary.issuesProcessed} issues`);
        console.log(`Total locations: ${result.summary.totalLocations}`);
        console.log(
          `By confidence: high=${result.summary.byConfidence.high}, medium=${result.summary.byConfidence.medium}, low=${result.summary.byConfidence.low}`,
        );

        for (const r of result.results) {
          console.log(`\n[Issue ${r.issue.id}] ${r.issue.description}`);
          for (const loc of r.locations) {
            console.log(`  ${loc.file}:${loc.lineNumber ?? 0} (${loc.confidence})`);
            console.log(`    ${loc.reasoning}`);
          }
        }
      }
    }),
).pipe(Command.withDescription('Find code locations for issues in a session'));
