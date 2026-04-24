/**
 * scan command - Capture and analyze a URL for visual issues.
 *
 * Usage: vex scan <url> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { Args, Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { Url } from '../../config/schema.js';
import { listDevices } from '../../core/devices.js';
import { runScanAudit } from '../audit-runner.js';
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
      yield* runScanAudit({
        resolved,
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
      });
    }),
).pipe(Command.withDescription('Capture and analyze a URL for visual issues'));
