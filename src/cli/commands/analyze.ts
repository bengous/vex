/**
 * analyze command - Analyze an existing screenshot for visual issues.
 *
 * Usage: vex analyze <image> [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Args, Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { parseIssuesFromResponse } from '../../core/validation.js';
import { resolveProviderLayer, VisionProvider } from '../../providers/index.js';
import { jsonOption, modelOption, outputOption, providerOption } from '../options.js';
// Import providers for self-registration
import '../../providers/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Image Argument
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Image path positional argument (required).
 */
const imageArg = Args.file({ name: 'image', exists: 'yes' });

// ═══════════════════════════════════════════════════════════════════════════
// Analyze Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze command implementation.
 */
export const analyzeCommand = Command.make(
  'analyze',
  {
    image: imageArg,
    provider: providerOption,
    model: modelOption,
    output: outputOption,
    json: jsonOption,
  },
  (args) =>
    Effect.gen(function* () {
      const imagePath = args.image;
      const providerName = Option.getOrElse(args.provider, () => 'ollama' as const);
      const model = Option.getOrUndefined(args.model);
      const outputDir = Option.getOrUndefined(args.output);

      if (!args.json) {
        console.log(`Analyzing ${imagePath}`);
        console.log(`Provider: ${providerName}`);
        console.log('');
      }

      const providerLayer = yield* resolveProviderLayer(providerName);

      const result = yield* Effect.gen(function* () {
        const provider = yield* VisionProvider;
        return yield* provider.analyze([imagePath], DEFAULT_PROMPT, { model });
      }).pipe(Effect.provide(providerLayer));

      // Parse and validate issues with partial recovery
      const issues = yield* parseIssuesFromResponse(result.response);

      // Write to output directory if specified (additive to console output)
      if (outputDir) {
        yield* Effect.promise(async () => {
          await mkdir(outputDir, { recursive: true });

          const imageName = basename(imagePath, extname(imagePath));
          const outputPath = join(outputDir, `${imageName}-analysis.json`);

          const output = {
            provider: result.provider,
            model: result.model,
            durationMs: result.durationMs,
            issues,
          };

          await writeFile(outputPath, JSON.stringify(output, null, 2));
          console.log(`Results written to: ${outputPath}`);
        });
      }

      if (args.json) {
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
    }),
).pipe(Command.withDescription('Analyze an existing screenshot for visual issues'));
