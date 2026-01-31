/**
 * locate command - Find code locations for issues in a session.
 *
 * Usage: vex locate <session> [options]
 *
 * Options:
 *   --project <dir>     Project root for code search (default: cwd)
 *   --patterns <glob>   File patterns to search (comma-separated)
 *   --json              Output results as JSON
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { loadDOMSnapshot } from '../../core/dom-snapshot-loader.js';
import type { Issue } from '../../core/types.js';
import { createResolverWithStrategies, domTracerStrategy } from '../../locator/index.js';
import type { LocatorContext } from '../../locator/types.js';

interface LocateOptions {
  sessionDir: string;
  projectRoot: string;
  filePatterns: string[];
  json: boolean;
}

function parseOptions(args: string[]): LocateOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: 'string', short: 'p' },
      patterns: { type: 'string' },
      json: { type: 'boolean', short: 'j' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: vex locate <session> [options]

Options:
  --project, -p <dir>    Project root for code search (default: cwd)
  --patterns <globs>     File patterns to search (comma-separated)
  --json, -j             Output results as JSON
  --help, -h             Show this help
`);
    process.exit(0);
  }

  const sessionDir = positionals[0];
  if (!sessionDir) {
    throw new Error('Session directory is required. Usage: vex locate <session>');
  }

  if (!existsSync(sessionDir)) {
    throw new Error(`Session not found: ${sessionDir}`);
  }

  return {
    sessionDir,
    projectRoot: values.project ?? process.cwd(),
    filePatterns: values.patterns ? values.patterns.split(',') : ['*.liquid', '*.css', '*.scss'],
    json: values.json ?? false,
  };
}

function loadSessionIssues(sessionDir: string): Issue[] {
  const statePath = join(sessionDir, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));

  // First check state.issues
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

export async function locateCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  console.log(`Loading session from ${options.sessionDir}`);
  console.log(`Searching in ${options.projectRoot}`);

  const issues = loadSessionIssues(options.sessionDir);
  console.log(`Found ${issues.length} issues to locate`);

  if (issues.length === 0) {
    console.log('No issues to locate');
    return;
  }

  // Load DOM snapshot from session
  const domResult = await loadDOMSnapshot(options.sessionDir);
  if (domResult.error) {
    console.warn(`DOM: ${domResult.error}`);
  }

  const resolver = createResolverWithStrategies([domTracerStrategy]);
  const ctx: LocatorContext = {
    projectRoot: options.projectRoot,
    filePatterns: options.filePatterns,
    domSnapshot: domResult.snapshot ?? undefined,
  };

  const result = await Effect.runPromise(resolver.locateAll(issues, ctx));

  if (options.json) {
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
}
