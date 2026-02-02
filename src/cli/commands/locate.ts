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

function loadSessionIssues(sessionDir: string): Issue[] {
  const statePath = join(sessionDir, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));

  if (state.issues && state.issues.length > 0) {
    return state.issues;
  }

  // Fall back to reading from analysis artifact
  const artifacts = state.artifacts as Record<string, { type?: string; path?: string }> | undefined;
  const analysisArtifact = artifacts ? Object.values(artifacts).find((a) => a.type === 'analysis') : undefined;

  if (analysisArtifact?.path && existsSync(analysisArtifact.path)) {
    const analysis = JSON.parse(readFileSync(analysisArtifact.path, 'utf-8'));
    return analysis.issues ?? [];
  }

  return [];
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

      const issues = loadSessionIssues(sessionDir);
      console.log(`Found ${issues.length} issues to locate`);

      if (issues.length === 0) {
        console.log('No issues to locate');
        return;
      }

      // Load DOM snapshot from session
      const domResult = yield* Effect.promise(() => loadDOMSnapshot(sessionDir));
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
