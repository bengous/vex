/**
 * Configuration loading for vex output directories.
 *
 * Priority:
 * 1. VEX_OUTPUT_DIR environment variable
 * 2. .vexrc.json in project root
 *
 * Throws if neither is configured - no default fallback.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Vex configuration.
 */
export interface VexConfig {
  /** Base output directory for sessions (required) */
  readonly outputDir: string;
  /** Subdirectory for test sessions (default: 'tests') */
  readonly testsSubdir?: string;
}

/**
 * Configuration error - thrown when required config is missing.
 */
export class VexConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VexConfigError';
  }
}

/**
 * Find project root by looking for package.json.
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  const root = dirname(current);

  while (current !== root) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = dirname(current);
  }

  return startDir;
}

/**
 * Load .vexrc.json from project root if it exists.
 */
function loadVexrcFile(projectRoot: string): Partial<VexConfig> | null {
  const vexrcPath = join(projectRoot, '.vexrc.json');

  if (!existsSync(vexrcPath)) {
    return null;
  }

  try {
    const content = readFileSync(vexrcPath, 'utf-8');
    return JSON.parse(content) as Partial<VexConfig>;
  } catch {
    return null;
  }
}

/**
 * Load vex configuration.
 *
 * @param projectRoot - Optional project root override (for testing)
 * @throws VexConfigError if output directory is not configured
 */
export function loadConfig(projectRoot?: string): VexConfig {
  const root = projectRoot ?? findProjectRoot();

  // Priority 1: Environment variable
  const envOutputDir = process.env.VEX_OUTPUT_DIR;
  if (envOutputDir) {
    const outputDir = resolve(root, envOutputDir);
    return {
      outputDir,
      testsSubdir: 'tests',
    };
  }

  // Priority 2: .vexrc.json
  const vexrc = loadVexrcFile(root);
  if (vexrc?.outputDir) {
    const outputDir = resolve(root, vexrc.outputDir);
    return {
      outputDir,
      testsSubdir: vexrc.testsSubdir ?? 'tests',
    };
  }

  // No configuration found
  throw new VexConfigError(
    `vex output directory not configured.

Set one of:
  - VEX_OUTPUT_DIR environment variable (e.g., VEX_OUTPUT_DIR=.vex)
  - outputDir in .vexrc.json (e.g., {"outputDir": ".vex"})`,
  );
}

/**
 * Get the output directory for a given mode.
 */
export function getOutputDir(config: VexConfig, mode: 'session' | 'test' = 'session'): string {
  if (mode === 'test' && config.testsSubdir) {
    return join(config.outputDir, config.testsSubdir);
  }
  return config.outputDir;
}
