/**
 * Mock PipelineContext factory for operation unit tests.
 *
 * Provides minimal implementations sufficient for testing operations
 * in isolation without running the full pipeline runtime.
 */

import { join } from 'node:path';
import { Effect } from 'effect';
import type { Artifact, ImageArtifact, ViewportConfig } from '../../core/types.js';
import type { DataKey, DataValue, Logger, PipelineContext } from '../../pipeline/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Mock Logger
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Silent logger that captures nothing (for quiet tests).
 */
export function createSilentLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * Capturing logger that stores all messages (for assertions).
 */
export interface CapturingLogger extends Logger {
  readonly messages: { level: string; message: string }[];
}

export function createCapturingLogger(): CapturingLogger {
  const messages: { level: string; message: string }[] = [];
  return {
    messages,
    debug: (msg) => messages.push({ level: 'debug', message: msg }),
    info: (msg) => messages.push({ level: 'info', message: msg }),
    warn: (msg) => messages.push({ level: 'warn', message: msg }),
    error: (msg) => messages.push({ level: 'error', message: msg }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock Context Factory
// ═══════════════════════════════════════════════════════════════════════════

export interface MockContextOptions {
  readonly sessionDir: string;
  readonly logger?: Logger;
}

/**
 * Create a mock PipelineContext for operation testing.
 *
 * @param options.sessionDir - Directory for artifact output
 * @param options.logger - Optional logger (defaults to silent)
 */
export function createMockContext(options: MockContextOptions): PipelineContext {
  const { sessionDir, logger = createSilentLogger() } = options;
  const artifacts = new Map<string, Artifact>();
  const data = new Map<string, unknown>();

  return {
    sessionDir,
    artifacts,
    logger,
    storeArtifact: (artifact) => {
      artifacts.set(artifact.id, artifact);
      return artifact.id;
    },
    getArtifact: (id) => artifacts.get(id),
    getData: <K extends DataKey>(key: K) => data.get(key) as DataValue<K> | undefined,
    getDataRaw: (key) => data.get(key),
    getViewportDir: () => Effect.succeed(sessionDir),
    getArtifactPath: (name) => Effect.succeed(join(sessionDir, `test-${name}.png`)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Image Artifact Factory
// ═══════════════════════════════════════════════════════════════════════════

export interface MockImageArtifactOptions {
  readonly path: string;
  readonly id?: string;
  readonly width?: number;
  readonly height?: number;
  readonly viewport?: ViewportConfig;
}

/**
 * Create a mock ImageArtifact for testing operations that consume images.
 */
export function createMockImageArtifact(options: MockImageArtifactOptions): ImageArtifact {
  const { path, id = crypto.randomUUID(), width = 1920, height = 1080, viewport } = options;

  return {
    _kind: 'artifact',
    id,
    type: 'image',
    path,
    createdAt: new Date().toISOString(),
    createdBy: 'test',
    metadata: {
      width,
      height,
      viewport,
    },
  };
}
