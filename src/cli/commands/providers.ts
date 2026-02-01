/**
 * providers command - List registered VLM providers and their models.
 *
 * Usage: vex providers [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { getAllProviders, type ProviderInfo } from '../../providers/introspection.js';
import { jsonOption } from '../options.js';
// Import providers for self-registration
import '../../providers/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

function formatProvider(info: ProviderInfo): string {
  const lines: string[] = [];
  const status = info.available ? '✓ available' : '✗ unavailable';

  lines.push(`${info.displayName} [${info.name}]`);
  lines.push(`  Status: ${status}`);
  lines.push(`  Type: ${info.type.toUpperCase()}${info.command ? ` (${info.command})` : ''}`);

  if (info.models.length > 0) {
    lines.push('  Models:');
    for (const model of info.models) {
      lines.push(`    - ${model}`);
    }
  }

  if (info.modelAliases && Object.keys(info.modelAliases).length > 0) {
    lines.push('  Aliases:');
    for (const [alias, target] of Object.entries(info.modelAliases)) {
      lines.push(`    ${alias} → ${target}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Providers Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Providers command implementation.
 */
export const providersCommand = Command.make(
  'providers',
  {
    json: jsonOption,
  },
  (args) =>
    Effect.gen(function* () {
      const providers = yield* getAllProviders();

      if (args.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }

      console.log('\nVEX Providers');
      console.log('=============\n');

      for (const provider of providers) {
        console.log(formatProvider(provider));
        console.log('');
      }

      const available = providers.filter((p) => p.available).length;
      console.log(`Total: ${providers.length} providers (${available} available)`);
    }),
).pipe(Command.withDescription('List registered VLM providers and models'));
