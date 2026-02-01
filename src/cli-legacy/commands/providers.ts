/**
 * providers command - List registered VLM providers and their models.
 *
 * Usage: vex providers [options]
 *
 * Options:
 *   --json, -j   Output as JSON
 *   --help, -h   Show help
 */

import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { getAllProviders, type ProviderInfo } from '../../providers/introspection.js';
// Import providers for self-registration
import '../../providers/index.js';

interface ProvidersOptions {
  json: boolean;
}

function parseOptions(args: string[]): ProvidersOptions {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', short: 'j' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: vex providers [options]

List all registered VLM providers with their models and aliases.

Options:
  --json, -j   Output results as JSON
  --help, -h   Show this help
`);
    process.exit(0);
  }

  return {
    json: values.json ?? false,
  };
}

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

export async function providersCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  const providers = await Effect.runPromise(getAllProviders());

  if (options.json) {
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
}
