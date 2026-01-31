/**
 * analyze command - Analyze an existing screenshot for visual issues.
 *
 * Usage: vex analyze <image> [options]
 *
 * Options:
 *   --provider <name>   VLM provider (default: ollama)
 *   --model <name>      Model override
 *   --output <dir>      Output directory
 *   --json              Output results as JSON
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import type { Issue } from '../../core/types.js';
import { resolveProviderLayer, VisionProvider } from '../../providers/index.js';
// Import providers for self-registration
import '../../providers/index.js';

interface AnalyzeOptions {
  imagePath: string;
  provider: string;
  model?: string;
  outputDir?: string;
  json: boolean;
}

const DEFAULT_PROMPT = `Analyze this web page screenshot for visual and layout issues.

For each issue found, provide:
1. A clear description of the problem
2. The severity (high, medium, low)
3. The approximate location using grid cell references (A1-J99) or pixel coordinates
4. A suggested fix

Format your response as JSON:
{
  "issues": [
    {
      "id": 1,
      "description": "...",
      "severity": "high|medium|low",
      "region": "A1" or {"x": 0, "y": 0, "width": 100, "height": 100},
      "suggestedFix": "..."
    }
  ]
}`;

function parseIssues(response: string): Issue[] {
  try {
    const jsonMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.issues)) return [];

    return parsed.issues.map((issue: Record<string, unknown>, idx: number) => ({
      id: typeof issue.id === 'number' ? issue.id : idx + 1,
      description: String(issue.description ?? ''),
      severity: ['high', 'medium', 'low'].includes(String(issue.severity)) ? issue.severity : 'medium',
      region: issue.region ?? 'A1',
      suggestedFix: issue.suggestedFix ? String(issue.suggestedFix) : undefined,
    })) as Issue[];
  } catch {
    return [];
  }
}

function parseOptions(args: string[]): AnalyzeOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm' },
      output: { type: 'string', short: 'o' },
      json: { type: 'boolean', short: 'j' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: vex analyze <image> [options]

Options:
  --provider, -p <name>  VLM provider (default: ollama)
  --model, -m <name>     Model override
  --output, -o <dir>     Output directory
  --json, -j             Output results as JSON
  --help, -h             Show this help
`);
    process.exit(0);
  }

  const imagePath = positionals[0];
  if (!imagePath) {
    throw new Error('Image path is required. Usage: vex analyze <image>');
  }

  if (!existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  return {
    imagePath,
    provider: values.provider ?? 'ollama',
    model: values.model,
    outputDir: values.output,
    json: values.json ?? false,
  };
}

export async function analyzeCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  if (!options.json) {
    console.log(`Analyzing ${options.imagePath}`);
    console.log(`Provider: ${options.provider}`);
    console.log('');
  }

  const program = Effect.gen(function* () {
    // Get provider layer
    const providerLayer = yield* resolveProviderLayer(options.provider);

    // Run analysis
    const result = yield* Effect.gen(function* () {
      const provider = yield* VisionProvider;
      return yield* provider.analyze([options.imagePath], DEFAULT_PROMPT, { model: options.model });
    }).pipe(Effect.provide(providerLayer));

    return result;
  });

  const result = await Effect.runPromise(program);
  const issues = parseIssues(result.response);

  // Write to output directory if specified (additive to console output)
  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });

    const imageName = basename(options.imagePath, extname(options.imagePath));
    const outputPath = join(options.outputDir, `${imageName}-analysis.json`);

    const output = {
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      issues,
    };

    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`Results written to: ${outputPath}`);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          provider: result.provider,
          model: result.model,
          durationMs: result.durationMs,
          issues,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Analysis (${result.provider}/${result.model}):`);
  console.log(`Duration: ${result.durationMs}ms`);

  if (issues.length > 0) {
    console.log(`\nIssues found (${issues.length}):`);
    for (const issue of issues) {
      const regionStr = typeof issue.region === 'string' ? issue.region : `(${issue.region.x},${issue.region.y})`;
      console.log(`  [${issue.severity.toUpperCase()}] ${issue.description} @ ${regionStr}`);
      if (issue.suggestedFix) {
        console.log(`           Fix: ${issue.suggestedFix}`);
      }
    }
  } else {
    console.log('\nNo issues found.');
  }
}
