/**
 * scan command - Capture and analyze a URL for visual issues.
 *
 * Usage: vex scan <url> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { Args, Command } from '@effect/cli';
import { Effect } from 'effect';
import { Url } from '../../config/schema.js';
import { listDevices, lookupDevice } from '../../core/devices.js';
import type { AnalysisResult, ViewportConfig } from '../../core/types.js';
import { fullAnnotation, runPipeline, simpleAnalysis } from '../../pipeline/index.js';
import {
  deviceOption,
  fullOption,
  listDevicesOption,
  modelOption,
  outputOption,
  placeholderMediaOption,
  presetOption,
  providerOption,
  reasoningOption,
} from '../options.js';
import type { ScanCliArgs } from '../resolve.js';
import { resolveScanOptions } from '../resolve.js';
// Import providers for self-registration
import '../../providers/index.js';

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
    full: fullOption,
    placeholderMedia: placeholderMediaOption,
    output: outputOption,
    listDevices: listDevicesOption,
  },
  (args) =>
    Effect.gen(function* () {
      // Handle --list-devices
      if (args.listDevices) {
        listDevices();
        return;
      }

      // Convert to ScanCliArgs format
      const cliArgs: ScanCliArgs = {
        url: args.url,
        preset: args.preset,
        device: args.device,
        provider: args.provider,
        model: args.model,
        reasoning: args.reasoning,
        full: args.full,
        placeholderMedia: args.placeholderMedia,
        output: args.output,
      };

      // Resolve options with preset/defaults
      const resolved = yield* resolveScanOptions(cliArgs);

      // Run pipeline for each URL and device
      for (const url of resolved.urls) {
        for (const deviceId of resolved.devices) {
          // Get viewport config
          const deviceResult = lookupDevice(deviceId);
          if (!deviceResult) {
            console.error(`Unknown device: ${deviceId}`);
            continue;
          }
          const viewport: ViewportConfig = deviceResult.preset.viewport;

          console.log(`Scanning ${url}`);
          console.log(`Viewport: ${viewport.width}x${viewport.height} (${deviceId})`);
          console.log(
            `Provider: ${resolved.provider}${resolved.model ? ` (model: ${resolved.model})` : ''}${resolved.reasoning ? ` (reasoning: ${resolved.reasoning})` : ''}`,
          );
          if (resolved.full) {
            console.log('Pipeline: full-annotation (analyze + annotate + render)');
          }
          if (resolved.placeholderMedia) {
            console.log('Placeholder media: enabled');
          }
          console.log('');

          // Build pipeline
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

          // Run pipeline
          const result = yield* runPipeline(pipeline, resolved.outputDir);

          console.log(`\nSession: ${result.sessionDir}`);
          console.log(`Status: ${result.status}`);

          // Display artifacts
          const artifacts = Object.values(result.artifacts);
          console.log(`\nArtifacts (${artifacts.length}):`);
          for (const artifact of artifacts) {
            console.log(`  - ${artifact.type}: ${artifact.path}`);
          }

          // Find and display analysis results
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
