/**
 * scan command - Capture and analyze a URL for visual issues.
 *
 * Usage: vex scan <url> [options]
 *
 * Options:
 *   --device <name>     Device preset (e.g., iphone-15-pro, desktop-1920)
 *   --viewport <WxH>    Viewport size (default: 1920x1080)
 *   --mobile            Use mobile viewport
 *   --list-devices      List available device presets
 *   --output <dir>      Output directory (overrides VEX_OUTPUT_DIR/.vexrc.json)
 *   --provider <name>   VLM provider (default: ollama)
 *   --model <name>      Model override
 */

import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { loadConfig, VexConfigError } from '../../core/config.js';
import { getAllDeviceIds, listDevices, lookupDevice } from '../../core/devices.js';
import type { AnalysisResult, ViewportConfig } from '../../core/types.js';
import { fullAnnotation, runPipeline, simpleAnalysis } from '../../pipeline/index.js';
// Import providers for self-registration
import '../../providers/index.js';

const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

const MOBILE_VIEWPORT: ViewportConfig = {
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

interface ScanOptions {
  url: string;
  viewport: ViewportConfig;
  outputDir: string;
  provider: string;
  model?: string;
  reasoning?: string;
  full?: boolean;
  placeholderMedia?: boolean;
}

function parseViewport(input: string): ViewportConfig {
  const match = input.match(/^(\d+)x(\d+)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid viewport format: ${input}. Use WxH format (e.g., 1920x1080)`);
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
    deviceScaleFactor: 1,
    isMobile: false,
  };
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function parseOptions(args: string[]): ScanOptions | 'list-devices' {
  const { values, positionals } = parseArgs({
    args,
    options: {
      device: { type: 'string', short: 'd' },
      viewport: { type: 'string', short: 'V' },
      mobile: { type: 'boolean', short: 'm' },
      'list-devices': { type: 'boolean' },
      output: { type: 'string', short: 'o' },
      provider: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'M' },
      reasoning: { type: 'string', short: 'R' },
      full: { type: 'boolean', short: 'f' },
      'placeholder-media': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values['list-devices']) {
    return 'list-devices';
  }

  if (values.help) {
    console.log(`
Usage: vex scan <url> [options]

Options:
  --device, -d <name>    Device preset (e.g., iphone-15-pro, desktop-1920)
  --viewport, -V <WxH>   Viewport size (default: 1920x1080)
  --mobile, -m           Use mobile viewport (375x812)
  --list-devices         List available device presets
  --output, -o <dir>     Output directory (overrides VEX_OUTPUT_DIR/.vexrc.json)
  --provider, -p <name>  VLM provider (default: ollama)
  --model, -M <name>     Model override
  --reasoning, -R <level> Reasoning effort (codex-cli: low, medium, high, xhigh)
  --full, -f             Full annotation pipeline (analyze + annotate + render)
  --placeholder-media    Replace images/videos with placeholder boxes
  --help, -h             Show this help

Configuration:
  Set output directory via:
  - --output flag (highest priority)
  - VEX_OUTPUT_DIR environment variable
  - outputDir in .vexrc.json
`);
    process.exit(0);
  }

  const url = positionals[0];
  if (!url) {
    throw new Error('URL is required. Usage: vex scan <url>');
  }

  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL: ${url}. URL must be a valid http:// or https:// URL.`);
  }

  // Priority: --device > --viewport > --mobile > default
  let viewport = DEFAULT_VIEWPORT;
  if (values.device) {
    const result = lookupDevice(values.device);
    if (!result) {
      const available = getAllDeviceIds().join(', ');
      throw new Error(
        `Unknown device "${values.device}".\n\nAvailable devices: ${available}\n\nRun 'vex scan --list-devices' for full list.`,
      );
    }
    viewport = result.preset.viewport;
  } else if (values.viewport) {
    viewport = parseViewport(values.viewport);
  } else if (values.mobile) {
    viewport = MOBILE_VIEWPORT;
  }

  // Resolve output directory: --output flag > config file/env
  let outputDir: string;
  if (values.output) {
    outputDir = values.output;
  } else {
    try {
      const config = loadConfig();
      outputDir = config.outputDir;
    } catch (e) {
      if (e instanceof VexConfigError) {
        throw new Error(`${e.message}\n\nOr use --output <dir> to specify directly.`);
      }
      throw e;
    }
  }

  return {
    url,
    viewport,
    outputDir,
    provider: values.provider ?? 'ollama',
    model: values.model,
    reasoning: values.reasoning,
    full: values.full,
    placeholderMedia: values['placeholder-media'],
  };
}

export async function scanCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);

  if (options === 'list-devices') {
    listDevices();
    return;
  }

  console.log(`Scanning ${options.url}`);
  console.log(`Viewport: ${options.viewport.width}x${options.viewport.height}`);
  console.log(
    `Provider: ${options.provider}${options.model ? ` (model: ${options.model})` : ''}${options.reasoning ? ` (reasoning: ${options.reasoning})` : ''}`,
  );
  if (options.full) {
    console.log('Pipeline: full-annotation (analyze + annotate + render)');
  }
  if (options.placeholderMedia) {
    console.log('Placeholder media: enabled');
  }
  console.log('');

  const pipeline = options.full
    ? fullAnnotation(
        options.url,
        options.viewport,
        options.provider,
        options.model,
        options.reasoning,
        options.placeholderMedia,
      )
    : simpleAnalysis(
        options.url,
        options.viewport,
        options.provider,
        options.model,
        options.reasoning,
        options.placeholderMedia,
      );

  const result = await Effect.runPromise(runPipeline(pipeline, options.outputDir));

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
    const analysisContent = await Bun.file(analysisArtifact.path).text();
    const analysis = JSON.parse(analysisContent) as AnalysisResult;

    console.log(`\nAnalysis (${analysis.provider}/${analysis.model}):`);
    console.log(`Duration: ${analysis.durationMs}ms`);

    if (analysis.issues.length > 0) {
      console.log(`\nIssues found (${analysis.issues.length}):`);
      for (const issue of analysis.issues) {
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
}
