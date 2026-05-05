/**
 * Mock PipelineContext factory for operation unit tests.
 *
 * Provides minimal implementations sufficient for testing operations
 * in isolation without running the full pipeline runtime.
 */

import type {
  Artifact,
  FoldOcclusionMetrics,
  ImageArtifact,
  ViewportConfig,
} from "../../core/types.js";
import type { DataKey, DataValue, Logger, PipelineContext } from "../../pipeline/types.js";
import { Effect } from "effect";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Logger
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Silent logger that captures nothing (for quiet tests).
 */
function createSilentLogger(): Logger {
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
export type CapturingLogger = {
  readonly messages: { level: string; message: string }[];
  readonly warnings: string[];
  readonly errors: string[];
} & Logger;

export function createCapturingLogger(): CapturingLogger {
  const messages: { level: string; message: string }[] = [];
  return {
    messages,
    get warnings() {
      return messages.filter((m) => m.level === "warn").map((m) => m.message);
    },
    get errors() {
      return messages.filter((m) => m.level === "error").map((m) => m.message);
    },
    debug: (msg) => messages.push({ level: "debug", message: msg }),
    info: (msg) => messages.push({ level: "info", message: msg }),
    warn: (msg) => messages.push({ level: "warn", message: msg }),
    error: (msg) => messages.push({ level: "error", message: msg }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock Context Factory
// ═══════════════════════════════════════════════════════════════════════════

export type MockContextOptions = {
  readonly sessionDir: string;
  readonly logger?: Logger;
};

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
    getArtifact: (id) => artifacts.get(id),
    getData: <K extends DataKey>(key: K) => data.get(key) as DataValue<K> | undefined,
    getViewportDir: () => Effect.succeed(sessionDir),
    getArtifactPath: (name) => Effect.succeed(join(sessionDir, `test-${name}.png`)),
    createArtifact: <T extends Artifact>(spec: {
      readonly type: T["type"];
      readonly path: string;
      readonly metadata: T["metadata"];
      readonly createdBy?: string;
    }): T => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        _kind: "artifact",
        id: crypto.randomUUID(),
        type: spec.type,
        path: spec.path,
        createdAt: new Date().toISOString(),
        createdBy: spec.createdBy ?? "test",
        metadata: spec.metadata,
      } as T;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Image Artifact Factory
// ═══════════════════════════════════════════════════════════════════════════

export type MockImageArtifactOptions = {
  readonly path: string;
  readonly id?: string;
  readonly width?: number;
  readonly height?: number;
  readonly viewport?: ViewportConfig;
  readonly foldOcclusion?: FoldOcclusionMetrics;
};

/**
 * Create a mock ImageArtifact for testing operations that consume images.
 */
export function createMockImageArtifact(options: MockImageArtifactOptions): ImageArtifact {
  const {
    path,
    id = crypto.randomUUID(),
    width = 1920,
    height = 1080,
    viewport,
    foldOcclusion,
  } = options;

  return {
    _kind: "artifact",
    id,
    type: "image",
    path,
    createdAt: new Date().toISOString(),
    createdBy: "test",
    metadata: {
      width,
      height,
      ...(viewport !== undefined ? { viewport } : {}),
      ...(foldOcclusion !== undefined ? { foldOcclusion } : {}),
    },
  };
}
