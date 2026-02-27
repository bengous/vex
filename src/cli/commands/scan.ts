/**
 * scan command - Capture and analyze a URL for visual issues.
 *
 * Usage: vex scan <url> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Args, Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { loadCodexProfile, loadConfigOptional } from '../../config/loader.js';
import { Url } from '../../config/schema.js';
import { listDevices, lookupDevice } from '../../core/devices.js';
import { type AnalysisResult, getViewportDirName, type ViewportConfig } from '../../core/types.js';
import { captureOnly, fullAnnotation, simpleAnalysis } from '../../pipeline/presets.js';
import { runPipeline } from '../../pipeline/runtime.js';
import { CodexEnv, makeCodexEnvResource } from '../../providers/codex-cli/environment.js';
import {
  deviceOption,
  fullOption,
  listDevicesOption,
  modelOption,
  outputOption,
  placeholderMediaOption,
  presetOption,
  providerOption,
  providerProfileOption,
  reasoningOption,
} from '../options.js';
import type { ScanCliArgs } from '../resolve.js';
import { resolveScanOptions } from '../resolve.js';
import { type AuditManifest, type AuditRunRecord, buildAuditId, getAuditPageDir } from '../scan-layout.js';

// ═══════════════════════════════════════════════════════════════════════════
// URL Argument
// ═══════════════════════════════════════════════════════════════════════════

/**
 * URL positional argument (optional - can come from preset).
 */
const urlArg = Args.text({ name: 'url' }).pipe(Args.withSchema(Url), Args.optional);

// ═══════════════════════════════════════════════════════════════════════════
// Scan Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan command implementation.
 */

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

function getAuditFinalStatus(manifest: AuditManifest, interrupted: boolean): AuditManifest['status'] {
  if (interrupted) return 'interrupted';
  if (manifest.totalRuns > 0 && manifest.failedRuns === manifest.totalRuns) return 'failed';
  return 'completed';
}

export const scanCommand = Command.make(
  'scan',
  {
    url: urlArg,
    preset: presetOption,
    device: deviceOption,
    provider: providerOption,
    model: modelOption,
    reasoning: reasoningOption,
    providerProfile: providerProfileOption,
    full: fullOption,
    placeholderMedia: placeholderMediaOption,
    output: outputOption,
    listDevices: listDevicesOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.listDevices) {
        listDevices();
        return;
      }

      const cliArgs: ScanCliArgs = {
        url: args.url,
        preset: args.preset,
        device: args.device,
        provider: args.provider,
        model: args.model,
        reasoning: args.reasoning,
        providerProfile: args.providerProfile,
        full: args.full,
        placeholderMedia: args.placeholderMedia,
        output: args.output,
      };

      const resolved = yield* resolveScanOptions(cliArgs);

      const auditId = buildAuditId();
      const auditDir = join(resolved.outputDir, auditId);
      const auditManifestPath = join(auditDir, 'audit.json');
      const configUsedPath = join(auditDir, 'config.used.json');
      const urlsPath = join(auditDir, 'urls.txt');
      const totalRuns = resolved.urls.length * resolved.devices.length;

      const manifest: AuditManifest = {
        type: 'vex-audit',
        auditId,
        status: 'running',
        startedAt: new Date().toISOString(),
        outputDir: auditDir,
        provider: resolved.provider,
        model: resolved.model,
        reasoning: resolved.reasoning,
        preset: Option.getOrUndefined(args.preset),
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

      const saveManifest = () => Effect.promise(() => writeFile(auditManifestPath, JSON.stringify(manifest, null, 2)));

      yield* Effect.promise(() => mkdir(join(auditDir, 'pages'), { recursive: true }));
      yield* Effect.promise(() => writeFile(urlsPath, `${resolved.urls.join('\n')}\n`, 'utf-8'));

      const configUsed = {
        generatedAt: new Date().toISOString(),
        command: 'scan',
        preset: Option.getOrUndefined(args.preset),
        cli: {
          url: Option.getOrUndefined(args.url),
          device: Option.getOrUndefined(args.device),
          provider: Option.getOrUndefined(args.provider),
          model: Option.getOrUndefined(args.model),
          reasoning: Option.getOrUndefined(args.reasoning),
          providerProfile: Option.getOrUndefined(args.providerProfile),
          full: args.full,
          placeholderMedia: args.placeholderMedia,
          output: Option.getOrUndefined(args.output),
        },
        resolved,
      };

      yield* Effect.promise(() => writeFile(configUsedPath, JSON.stringify(configUsed, null, 2)));
      yield* saveManifest();

      console.log(`Audit: ${auditDir}`);
      console.log(`Targets: ${totalRuns} (${resolved.urls.length} URL(s) x ${resolved.devices.length} device(s))`);
      console.log('');

      let interrupted = false;
      const onSigInt = () => {
        if (!interrupted) {
          interrupted = true;
          console.warn('\n[WARN] Interrupt received. Finishing current page, then stopping audit.');
        }
      };
      const onSigTerm = () => {
        if (!interrupted) {
          interrupted = true;
          console.warn('\n[WARN] Termination requested. Finishing current page, then stopping audit.');
        }
      };

      process.on('SIGINT', onSigInt);
      process.on('SIGTERM', onSigTerm);

      try {
        for (const url of resolved.urls) {
          if (interrupted) break;
          for (const deviceId of resolved.devices) {
            if (interrupted) break;
            const runStartedAt = new Date().toISOString();

            const deviceResult = lookupDevice(deviceId);
            if (!deviceResult) {
              const failedRun: AuditRunRecord = {
                url,
                deviceId,
                pagePath: relative(auditDir, getAuditPageDir(auditDir, url)),
                viewportPath: '',
                status: 'failed',
                startedAt: runStartedAt,
                completedAt: new Date().toISOString(),
                error: `Unknown device: ${deviceId}`,
              };
              manifest.runs.push(failedRun);
              manifest.failedRuns += 1;
              yield* saveManifest();
              console.error(`Unknown device: ${deviceId}`);
              continue;
            }

            const viewport: ViewportConfig = deviceResult.preset.viewport;
            const pageDir = getAuditPageDir(auditDir, url);
            const viewportDirName = getViewportDirName(viewport);
            const viewportDir = join(pageDir, viewportDirName);

            const run: AuditRunRecord = {
              url,
              deviceId,
              viewport,
              pagePath: relative(auditDir, pageDir),
              viewportPath: relative(auditDir, viewportDir),
              status: 'running',
              startedAt: runStartedAt,
            };
            manifest.runs.push(run);
            yield* saveManifest();

            console.log(`Scanning ${url}`);
            console.log(`Viewport: ${viewport.width}x${viewport.height} (${deviceId})`);
            if (resolved.mode === 'capture-only') {
              console.log('Pipeline: capture-only (no model call)');
            } else {
              console.log(
                `Provider: ${resolved.provider}${resolved.model ? ` (model: ${resolved.model})` : ''}${resolved.reasoning ? ` (reasoning: ${resolved.reasoning})` : ''}${resolved.profile !== 'minimal' ? ` (profile: ${resolved.profile})` : ''}`,
              );
              if (resolved.full) {
                console.log('Pipeline: full-annotation (analyze + annotate + render)');
              } else {
                console.log('Pipeline: simple-analysis (capture + analyze)');
              }
            }
            if (resolved.placeholderMedia) {
              console.log('Placeholder media: enabled');
            }
            if (resolved.fullPageScrollFix) {
              console.log('Full-page scroll fix: enabled');
            }
            console.log(`Output: ${viewportDir}`);
            console.log('');

            const pipeline =
              resolved.mode === 'capture-only'
                ? captureOnly(url, viewport, true, true, resolved.placeholderMedia, resolved.fullPageScrollFix)
                : resolved.full
                  ? fullAnnotation(
                      url,
                      viewport,
                      resolved.provider,
                      resolved.model,
                      resolved.reasoning,
                      resolved.placeholderMedia,
                      resolved.fullPageScrollFix,
                    )
                  : simpleAnalysis(
                      url,
                      viewport,
                      resolved.provider,
                      resolved.model,
                      resolved.reasoning,
                      resolved.placeholderMedia,
                      resolved.fullPageScrollFix,
                    );

            const runOptions = {
              sessionId: viewportDirName,
              artifactLayout: 'session-root' as const,
            };

            try {
              // Run pipeline with scoped environment when profile is active
              const needsScopedEnv = resolved.provider === 'codex-cli' && resolved.profile !== 'minimal';
              const result = needsScopedEnv
                ? yield* Effect.scoped(
                    Effect.gen(function* () {
                      const config = yield* loadConfigOptional();
                      const profile = yield* loadCodexProfile(resolved.profile, config);
                      const codexEnv = yield* makeCodexEnvResource(profile);
                      return yield* runPipeline(pipeline, pageDir, undefined, runOptions).pipe(
                        Effect.provideService(CodexEnv, codexEnv),
                      );
                    }),
                  )
                : yield* runPipeline(pipeline, pageDir, undefined, runOptions);

              run.status = result.status === 'completed' ? 'completed' : 'failed';
              run.completedAt = new Date().toISOString();
              run.issueCount = result.issues.length;
              if (run.status === 'completed') {
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

              const analysisArtifact = artifacts.find((a) => a.type === 'analysis');
              if (analysisArtifact) {
                const analysisContent = yield* Effect.promise(() => Bun.file(analysisArtifact.path).text());
                const analysis = JSON.parse(analysisContent) as AnalysisResult;

                console.log(`\nAnalysis (${analysis.provider}/${analysis.model}):`);
                console.log(`Duration: ${analysis.durationMs}ms`);

                if (analysis.issues.length > 0) {
                  console.log(`\nIssues found (${analysis.issues.length}):`);
                  for (const issue of analysis.issues) {
                    const regionStr =
                      typeof issue.region === 'string' ? issue.region : `(${issue.region.x},${issue.region.y})`;
                    console.log(`  [${issue.severity.toUpperCase()}] ${issue.description} @ ${regionStr}`);
                    if (issue.suggestedFix) {
                      console.log(`           Fix: ${issue.suggestedFix}`);
                    }
                  }
                } else {
                  console.log('\nNo issues found.');
                }
              } else if (resolved.mode === 'capture-only') {
                console.log('\nAnalysis skipped (capture-only mode).');
              }

              console.log('');
            } catch (error) {
              run.status = 'failed';
              run.error = toErrorMessage(error);
              run.completedAt = new Date().toISOString();
              manifest.failedRuns += 1;
              yield* saveManifest();

              console.error(`[ERROR] Failed ${url} (${deviceId}): ${run.error}`);
              console.log('');
            }
          }
        }
      } finally {
        process.off('SIGINT', onSigInt);
        process.off('SIGTERM', onSigTerm);
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
      console.log('');
    }),
).pipe(Command.withDescription('Capture and analyze a URL for visual issues'));
