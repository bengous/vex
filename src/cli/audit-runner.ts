import type { AnalysisResult } from "../core/types.js";
import type { ResolvedScanOptions } from "./resolve.js";
import type { AuditManifest, AuditRunRecord } from "./scan-layout.js";
import type { FileSystem } from "@effect/platform";
import { Data, Effect, Schema as S } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getAllDeviceIds, lookupDevice } from "../core/devices.js";
import { Issue as IssueSchema } from "../core/schema.js";
import { getViewportDirName } from "../core/types.js";
import { runPipeline } from "../pipeline/runtime.js";
import { withProviderExecution } from "../providers/shared/profile-execution.js";
import { buildAuditId, getAuditPageDir, getAuditViewportDir } from "./scan-layout.js";
import { buildScanPipeline } from "./scan-pipeline.js";

export type ScanAuditCliMetadata = {
  readonly url: string | undefined;
  readonly device: string | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly providerProfile: string | undefined;
  readonly full: boolean;
  readonly placeholderMedia: boolean;
  readonly output: string | undefined;
};

export type RunScanAuditOptions = {
  readonly resolved: ResolvedScanOptions;
  readonly preset: string | undefined;
  readonly cli: ScanAuditCliMetadata;
};

export class AuditRunError extends Data.TaggedError("AuditRunError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const AnalysisResultSchema = S.Struct({
  provider: S.String,
  model: S.String,
  response: S.String,
  durationMs: S.Number,
  issues: S.Array(IssueSchema),
  rawJson: S.optional(S.Unknown),
});

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

export function getAuditFinalStatus(
  manifest: AuditManifest,
  interrupted: boolean,
): AuditManifest["status"] {
  if (interrupted) {
    return "interrupted";
  }
  if (manifest.totalRuns > 0 && manifest.failedRuns === manifest.totalRuns) {
    return "failed";
  }
  return "completed";
}

export function runScanAudit(
  options: RunScanAuditOptions,
): Effect.Effect<void, AuditRunError, FileSystem.FileSystem> {
  const { cli, preset, resolved } = options;

  return Effect.gen(function* () {
    const auditId = buildAuditId();
    const auditDir = join(resolved.outputDir, auditId);
    const auditManifestPath = join(auditDir, "audit.json");
    const configUsedPath = join(auditDir, "config.used.json");
    const urlsPath = join(auditDir, "urls.txt");
    const totalRuns = resolved.urls.length * resolved.devices.length;

    const manifest: AuditManifest = {
      type: "vex-audit",
      auditId,
      status: "running",
      startedAt: new Date().toISOString(),
      outputDir: auditDir,
      provider: resolved.provider,
      model: resolved.model,
      reasoning: resolved.reasoning,
      preset,
      urls: resolved.urls,
      devices: resolved.devices,
      mode: resolved.mode,
      full: resolved.full,
      placeholderMedia: resolved.placeholderMedia !== undefined,
      fullPageScrollFix: resolved.fullPageScrollFix !== undefined,
      totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      runs: [],
    };

    const saveManifest = () =>
      Effect.promise(async () => writeFile(auditManifestPath, JSON.stringify(manifest, null, 2)));

    yield* Effect.promise(async () => mkdir(join(auditDir, "pages"), { recursive: true }));
    yield* Effect.promise(async () =>
      writeFile(urlsPath, `${resolved.urls.join("\n")}\n`, "utf-8"),
    );

    const configUsed = {
      generatedAt: new Date().toISOString(),
      command: "scan",
      preset,
      cli,
      resolved,
    };

    yield* Effect.promise(async () =>
      writeFile(configUsedPath, JSON.stringify(configUsed, null, 2)),
    );
    yield* saveManifest();

    console.log(`Audit: ${auditDir}`);
    console.log(
      `Targets: ${totalRuns} (${resolved.urls.length} URL(s) x ${resolved.devices.length} device(s))`,
    );
    console.log("");

    let interrupted = false;
    const onSigInt = () => {
      if (!interrupted) {
        interrupted = true;
        console.warn("\n[WARN] Interrupt received. Finishing current page, then stopping audit.");
      }
    };
    const onSigTerm = () => {
      if (!interrupted) {
        interrupted = true;
        console.warn(
          "\n[WARN] Termination requested. Finishing current page, then stopping audit.",
        );
      }
    };

    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);

    try {
      for (const url of resolved.urls) {
        if (interrupted) {
          break;
        }
        for (const deviceId of resolved.devices) {
          if (interrupted) {
            break;
          }
          const runStartedAt = new Date().toISOString();

          const deviceResult = lookupDevice(deviceId);
          if (deviceResult === undefined) {
            const validDevices = getAllDeviceIds().join(", ");
            const unknownDeviceMessage = `Unknown device: ${deviceId}.
Use explicit device IDs (e.g., iphone-se-2016 or iphone-se-2022).
Valid devices: ${validDevices}`;
            const failedRun: AuditRunRecord = {
              url,
              deviceId,
              pagePath: relative(auditDir, getAuditPageDir(auditDir, url)),
              viewportPath: "",
              status: "failed",
              startedAt: runStartedAt,
              completedAt: new Date().toISOString(),
              error: unknownDeviceMessage,
            };
            manifest.runs.push(failedRun);
            manifest.failedRuns += 1;
            yield* saveManifest();
            return yield* new AuditRunError({ detail: unknownDeviceMessage });
          }

          const viewport = deviceResult.preset.viewport;
          const pageDir = getAuditPageDir(auditDir, url);
          const viewportDirName = getViewportDirName(viewport, deviceId);
          const viewportDir = getAuditViewportDir(auditDir, url, viewport, deviceId);

          const run: AuditRunRecord = {
            url,
            deviceId,
            viewport,
            pagePath: relative(auditDir, pageDir),
            viewportPath: relative(auditDir, viewportDir),
            status: "running",
            startedAt: runStartedAt,
          };
          manifest.runs.push(run);
          yield* saveManifest();

          console.log(`Scanning ${url}`);
          console.log(`Viewport: ${viewport.width}x${viewport.height} (${deviceId})`);
          if (resolved.mode === "capture-only") {
            console.log("Pipeline: capture-only (no model call)");
          } else {
            console.log(
              `Provider: ${resolved.provider}${resolved.model !== undefined && resolved.model.length > 0 ? ` (model: ${resolved.model})` : ""}${resolved.reasoning !== undefined && resolved.reasoning.length > 0 ? ` (reasoning: ${resolved.reasoning})` : ""}${resolved.profile !== "minimal" ? ` (profile: ${resolved.profile})` : ""}`,
            );
            if (resolved.full) {
              console.log("Pipeline: full-annotation (analyze + annotate + render)");
            } else {
              console.log("Pipeline: simple-analysis (capture + analyze)");
            }
          }
          if (resolved.placeholderMedia !== undefined) {
            console.log("Placeholder media: enabled");
          }
          if (resolved.fullPageScrollFix !== undefined) {
            console.log("Full-page scroll fix: enabled");
          }
          console.log(`Output: ${viewportDir}`);
          console.log("");

          const pipeline = buildScanPipeline({
            url,
            viewport,
            mode: resolved.mode,
            full: resolved.full,
            provider: resolved.provider,
            model: resolved.model,
            reasoning: resolved.reasoning,
            placeholderMedia: resolved.placeholderMedia,
            fullPageScrollFix: resolved.fullPageScrollFix,
          });

          const runOptions = {
            sessionId: viewportDirName,
            artifactLayout: "session-root" as const,
          };

          const runExit = yield* Effect.either(
            Effect.gen(function* () {
              const result = yield* withProviderExecution(
                { provider: resolved.provider, profile: resolved.profile },
                runPipeline(pipeline, pageDir, undefined, runOptions),
              );

              run.status = result.status === "completed" ? "completed" : "failed";
              run.completedAt = new Date().toISOString();
              run.issueCount = result.issues.length;
              if (run.status === "completed") {
                manifest.completedRuns += 1;
              } else {
                manifest.failedRuns += 1;
              }
              yield* saveManifest();

              console.log(`\nSession: ${result.sessionDir}`);
              console.log(`Status: ${result.status}`);

              const artifacts = Object.values(result.artifacts);
              console.log(`\nArtifacts (${artifacts.length}):`);
              for (const artifact of artifacts) {
                console.log(`  - ${artifact.type}: ${artifact.path}`);
              }

              const analysisArtifact = artifacts.find((artifact) => artifact.type === "analysis");
              if (analysisArtifact !== undefined) {
                const analysisContent = yield* Effect.promise(async () =>
                  Bun.file(analysisArtifact.path).text(),
                );
                const analysis = (yield* S.decodeUnknown(S.parseJson(AnalysisResultSchema))(
                  analysisContent,
                )) as AnalysisResult;

                console.log(`\nAnalysis (${analysis.provider}/${analysis.model}):`);
                console.log(`Duration: ${analysis.durationMs}ms`);

                if (analysis.issues.length > 0) {
                  console.log(`\nIssues found (${analysis.issues.length}):`);
                  for (const issue of analysis.issues) {
                    const regionStr =
                      typeof issue.region === "string"
                        ? issue.region
                        : `(${issue.region.x},${issue.region.y})`;
                    console.log(
                      `  [${issue.severity.toUpperCase()}] ${issue.description} @ ${regionStr}`,
                    );
                    if (issue.suggestedFix !== undefined && issue.suggestedFix.length > 0) {
                      console.log(`           Fix: ${issue.suggestedFix}`);
                    }
                  }
                } else {
                  console.log("\nNo issues found.");
                }
              } else if (resolved.mode === "capture-only") {
                console.log("\nAnalysis skipped (capture-only mode).");
              }

              console.log("");
            }),
          );

          if (runExit._tag === "Left") {
            const error = runExit.left;
            run.status = "failed";
            run.error = toErrorMessage(error);
            run.completedAt = new Date().toISOString();
            manifest.failedRuns += 1;
            yield* saveManifest();

            console.error(`[ERROR] Failed ${url} (${deviceId}): ${run.error}`);
            console.log("");
          }
        }
      }
    } finally {
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    }

    manifest.status = getAuditFinalStatus(manifest, interrupted);
    manifest.completedAt = new Date().toISOString();
    yield* saveManifest();

    console.log(`Audit complete: ${manifest.status}`);
    console.log(`Completed runs: ${manifest.completedRuns}/${manifest.totalRuns}`);
    if (manifest.failedRuns > 0) {
      console.log(`Failed runs: ${manifest.failedRuns}`);
    }
    console.log(`Audit metadata: ${auditManifestPath}`);
    console.log("");
  }).pipe(
    Effect.mapError((error) =>
      error instanceof AuditRunError ? error : new AuditRunError({ detail: toErrorMessage(error) }),
    ),
  );
}
