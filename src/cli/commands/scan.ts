/**
 * scan command - Capture and analyze a URL for visual issues.
 *
 * Usage: vex scan <url> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { Args, Command } from '@effect/cli';
import { Effect } from 'effect';
import { loadCodexProfile, loadConfigOptional } from '../../config/loader.js';
import { Url } from '../../config/schema.js';
import { listDevices, lookupDevice } from '../../core/devices.js';
import type { AnalysisResult, ViewportConfig } from '../../core/types.js';
import { fullAnnotation, simpleAnalysis } from '../../pipeline/presets.js';
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

      for (const url of resolved.urls) {
        for (const deviceId of resolved.devices) {
          const deviceResult = lookupDevice(deviceId);
          if (!deviceResult) {
            console.error(`Unknown device: ${deviceId}`);
            continue;
          }
          const viewport: ViewportConfig = deviceResult.preset.viewport;

          console.log(`Scanning ${url}`);
          console.log(`Viewport: ${viewport.width}x${viewport.height} (${deviceId})`);
          console.log(
            `Provider: ${resolved.provider}${resolved.model ? ` (model: ${resolved.model})` : ''}${resolved.reasoning ? ` (reasoning: ${resolved.reasoning})` : ''}${resolved.profile !== 'minimal' ? ` (profile: ${resolved.profile})` : ''}`,
          );
          if (resolved.full) {
            console.log('Pipeline: full-annotation (analyze + annotate + render)');
          }
          if (resolved.placeholderMedia) {
            console.log('Placeholder media: enabled');
          }
          console.log('');

          const pipeline = resolved.full
            ? fullAnnotation(
                url,
                viewport,
                resolved.provider,
                resolved.model,
                resolved.reasoning,
                resolved.placeholderMedia,
              )
            : simpleAnalysis(
                url,
                viewport,
                resolved.provider,
                resolved.model,
                resolved.reasoning,
                resolved.placeholderMedia,
              );

          // Run pipeline with scoped environment when profile is active
          const needsScopedEnv = resolved.provider === 'codex-cli' && resolved.profile !== 'minimal';
          const result = needsScopedEnv
            ? yield* Effect.scoped(
                Effect.gen(function* () {
                  const config = yield* loadConfigOptional();
                  const profile = yield* loadCodexProfile(resolved.profile, config);
                  const codexEnv = yield* makeCodexEnvResource(profile);
                  return yield* runPipeline(pipeline, resolved.outputDir).pipe(
                    Effect.provideService(CodexEnv, codexEnv),
                  );
                }),
              )
            : yield* runPipeline(pipeline, resolved.outputDir);

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
          }

          console.log('');
        }
      }
    }),
).pipe(Command.withDescription('Capture and analyze a URL for visual issues'));
