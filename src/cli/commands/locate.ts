/**
 * locate command - Find code locations for issues in a session or scan audit.
 *
 * Usage: vex locate <session-or-audit> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import type { Issue } from "../../core/types.js";
import type { BatchResolutionResult, LocatorContext } from "../../locator/types.js";
import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadDOMSnapshot } from "../../core/dom-snapshot-loader.js";
import { decodeJson, encodeJson } from "../../core/json.js";
import { createResolverWithStrategies } from "../../locator/resolver.js";
import { domTracerStrategy } from "../../locator/strategies/dom-tracer.js";
import { jsonOption, patternsOption, projectOption } from "../options.js";

// ═══════════════════════════════════════════════════════════════════════════
// Session Directory Argument
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Session directory positional argument.
 */
const sessionArg = Args.directory({ name: "session" });

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type JsonObject = Record<string, unknown>;

type AnalysisArtifactRef = {
  readonly type?: string;
  readonly path?: string;
};

export type LocateSessionContext = {
  readonly issues: Issue[];
  readonly domSessionDir: string;
};

export type LocateTargetContext = {
  readonly source: string;
  readonly issues: Issue[];
  readonly domSessionDir: string;
};

export type LocateTargetSet = {
  readonly kind: "session" | "audit";
  readonly targets: readonly LocateTargetContext[];
};

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null ? (value as JsonObject) : undefined;
}

function loadIssuesFromAnalysisArtifacts(
  artifacts: Record<string, AnalysisArtifactRef> | undefined,
): Issue[] {
  const analysisArtifact =
    artifacts !== undefined
      ? Object.values(artifacts).find((a) => a.type === "analysis")
      : undefined;
  const analysisPath = analysisArtifact?.path;
  if (analysisPath === undefined || analysisPath.length === 0 || !existsSync(analysisPath)) {
    return [];
  }

  try {
    const analysis = decodeJson(readFileSync(analysisPath, "utf-8")) as {
      issues?: unknown;
    };
    return Array.isArray(analysis.issues) ? (analysis.issues as Issue[]) : [];
  } catch {
    return [];
  }
}

function collectStateFilesRecursive(rootDir: string): string[] {
  const stack = [rootDir];
  const files: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === "state.json") {
        files.push(fullPath);
      }
    }
  }

  files.sort();
  return files;
}

export function loadLocateSessionContext(sessionDir: string): LocateSessionContext {
  const statePath = join(sessionDir, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(`Session state not found: ${statePath}`);
  }

  const state = decodeJson(readFileSync(statePath, "utf-8"));
  const stateObj = asObject(state);
  if (stateObj === undefined) {
    return { issues: [], domSessionDir: sessionDir };
  }

  let domSessionDir = sessionDir;

  if (stateObj["type"] === "vex-loop") {
    const iterations = Array.isArray(stateObj["iterationHistory"])
      ? stateObj["iterationHistory"]
      : [];
    const latestIteration = asObject(iterations.at(-1));
    const latestPipelineState = asObject(latestIteration?.["pipelineState"]);

    if (typeof latestPipelineState?.["sessionDir"] === "string") {
      domSessionDir = latestPipelineState["sessionDir"];
    }

    const loopIssues = latestIteration?.["issuesFound"];
    if (Array.isArray(loopIssues) && loopIssues.length > 0) {
      return { issues: loopIssues as Issue[], domSessionDir };
    }

    const pipelineIssues = latestPipelineState?.["issues"];
    if (Array.isArray(pipelineIssues) && pipelineIssues.length > 0) {
      return { issues: pipelineIssues as Issue[], domSessionDir };
    }

    const latestPipelineArtifacts = asObject(latestPipelineState?.["artifacts"]) as
      | Record<string, AnalysisArtifactRef>
      | undefined;
    const latestPipelineAnalysisIssues = loadIssuesFromAnalysisArtifacts(latestPipelineArtifacts);
    if (latestPipelineAnalysisIssues.length > 0) {
      return { issues: latestPipelineAnalysisIssues, domSessionDir };
    }
  }

  if (Array.isArray(stateObj["issues"]) && stateObj["issues"].length > 0) {
    return { issues: stateObj["issues"] as Issue[], domSessionDir };
  }

  const rootArtifacts = asObject(stateObj["artifacts"]) as
    | Record<string, AnalysisArtifactRef>
    | undefined;
  return { issues: loadIssuesFromAnalysisArtifacts(rootArtifacts), domSessionDir };
}

export function loadLocateTargetSet(targetDir: string): LocateTargetSet {
  const auditPath = join(targetDir, "audit.json");
  const pagesDir = join(targetDir, "pages");

  if (existsSync(auditPath) && existsSync(pagesDir)) {
    const statePaths = collectStateFilesRecursive(pagesDir);
    const targets = statePaths.map((statePath) => {
      const sessionDir = dirname(statePath);
      const context = loadLocateSessionContext(sessionDir);
      return {
        source: relative(targetDir, sessionDir),
        issues: context.issues,
        domSessionDir: context.domSessionDir,
      } satisfies LocateTargetContext;
    });
    return {
      kind: "audit",
      targets,
    };
  }

  return {
    kind: "session",
    targets: [
      {
        source: targetDir,
        ...loadLocateSessionContext(targetDir),
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Locate Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Locate command implementation.
 */
export const locateCommand = Command.make(
  "locate",
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
      const filePatterns =
        patternsStr !== undefined && patternsStr.length > 0
          ? patternsStr.split(",")
          : ["*.liquid", "*.css", "*.scss"];
      const jsonOutput = args.json;

      console.log(`Loading target from ${sessionDir}`);
      console.log(`Searching in ${projectRoot}`);

      const resolver = createResolverWithStrategies([domTracerStrategy]);
      const targetSet = loadLocateTargetSet(sessionDir);

      if (targetSet.kind === "session") {
        const [target] = targetSet.targets;
        if (target === undefined) {
          console.log("No issues to locate");
          return;
        }

        console.log(`Found ${target.issues.length} issues to locate`);
        if (target.issues.length === 0) {
          console.log("No issues to locate");
          return;
        }

        const domResult = yield* Effect.promise(async () => loadDOMSnapshot(target.domSessionDir));
        if (domResult.error !== undefined && domResult.error.length > 0) {
          console.warn(`DOM: ${domResult.error}`);
        }

        const ctx: LocatorContext = {
          projectRoot,
          filePatterns,
          ...(domResult.snapshot !== undefined && domResult.snapshot !== null
            ? { domSnapshot: domResult.snapshot }
            : {}),
        };

        const result = yield* resolver.locateAll(target.issues, ctx);

        if (jsonOutput) {
          console.log(encodeJson(result));
        } else {
          console.log(
            `\nLocated ${result.summary.issuesWithLocations}/${result.summary.issuesProcessed} issues`,
          );
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
        return;
      }

      console.log(`Audit mode: found ${targetSet.targets.length} page/viewport session(s)`);
      const targetResults: Array<{ source: string; result: BatchResolutionResult }> = [];
      const byConfidence: { high: number; medium: number; low: number } = {
        high: 0,
        medium: 0,
        low: 0,
      };
      let issuesProcessed = 0;
      let issuesWithLocations = 0;
      let totalLocations = 0;

      for (const target of targetSet.targets) {
        if (target.issues.length === 0) {
          continue;
        }

        const domResult = yield* Effect.promise(async () => loadDOMSnapshot(target.domSessionDir));
        if (domResult.error !== undefined && domResult.error.length > 0) {
          console.warn(`DOM (${target.source}): ${domResult.error}`);
        }

        const ctx: LocatorContext = {
          projectRoot,
          filePatterns,
          ...(domResult.snapshot !== undefined && domResult.snapshot !== null
            ? { domSnapshot: domResult.snapshot }
            : {}),
        };

        const result = yield* resolver.locateAll(target.issues, ctx);
        targetResults.push({ source: target.source, result });
        issuesProcessed += result.summary.issuesProcessed;
        issuesWithLocations += result.summary.issuesWithLocations;
        totalLocations += result.summary.totalLocations;
        byConfidence.high += result.summary.byConfidence.high;
        byConfidence.medium += result.summary.byConfidence.medium;
        byConfidence.low += result.summary.byConfidence.low;
      }

      const auditResult = {
        type: "vex-locate-audit",
        target: sessionDir,
        summary: {
          targetsProcessed: targetSet.targets.length,
          targetsWithIssues: targetResults.length,
          issuesProcessed,
          issuesWithLocations,
          totalLocations,
          byConfidence,
        },
        results: targetResults,
      };

      if (jsonOutput) {
        console.log(encodeJson(auditResult));
      } else {
        console.log(
          `\nTargets with issues: ${auditResult.summary.targetsWithIssues}/${auditResult.summary.targetsProcessed}`,
        );
        console.log(`Issues located: ${issuesWithLocations}/${issuesProcessed}`);
        console.log(`Total locations: ${totalLocations}`);
        console.log(
          `By confidence: high=${byConfidence.high}, medium=${byConfidence.medium}, low=${byConfidence.low}`,
        );

        for (const targetResult of targetResults) {
          console.log(`\n[Target] ${targetResult.source}`);
          for (const r of targetResult.result.results) {
            console.log(`  [Issue ${r.issue.id}] ${r.issue.description}`);
            for (const loc of r.locations) {
              console.log(`    ${loc.file}:${loc.lineNumber ?? 0} (${loc.confidence})`);
              console.log(`      ${loc.reasoning}`);
            }
          }
        }
      }
    }),
).pipe(Command.withDescription("Find code locations for issues in a session or scan audit"));
