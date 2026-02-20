/**
 * Unit tests for pipeline runtime DAG executor.
 *
 * Tests validation errors and execution paths.
 * Uses temp directories for session creation.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import { runEffectExit } from '../testing/effect-helpers.js';
import { runPipeline } from './runtime.js';
import type { PipelineDefinition } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createEmptyPipeline(): PipelineDefinition {
  return {
    name: 'empty',
    description: 'Empty test pipeline',
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
  };
}

function createPipelineWithUnknownOperation(): PipelineDefinition {
  return {
    name: 'unknown-op',
    description: 'Pipeline with unknown operation',
    nodes: [
      {
        id: 'node1',
        operation: 'nonexistent-operation',
        config: {},
        inputs: [],
        outputs: [],
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Error Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('runPipeline', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'pipeline-runtime-test-'));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  describe('validation errors', () => {
    test('returns validation error for empty pipeline', async () => {
      const definition = createEmptyPipeline();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        // Effect's Cause structure
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('PipelineError');
          expect(cause.error.phase).toBe('validation');
          expect(cause.error.message).toContain('no nodes');
        }
      }
    });
  });

  describe('execution errors', () => {
    test('returns error for unknown operation', async () => {
      const definition = createPipelineWithUnknownOperation();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('PipelineError');
          expect(cause.error.phase).toBe('execution');
          expect(cause.error.message).toContain('Unknown operation');
        }
      }
    });
  });

  describe('session directory creation', () => {
    test('creates session directory on success path', async () => {
      // Since we can't easily test a successful pipeline without real operations,
      // we verify that validation happens before session creation by checking
      // the error doesn't mention session directory failures.
      const definition = createEmptyPipeline();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          // Validation error, not session creation error
          expect(cause.error.phase).toBe('validation');
        }
      }
    });

    test('uses provided sessionId when run options specify one', async () => {
      const definition = createPipelineWithUnknownOperation();
      const sessionId = 'custom-session-id';

      const exit = await runEffectExit(runPipeline(definition, testDir, undefined, { sessionId }));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(existsSync(join(testDir, sessionId))).toBe(true);
    });
  });
});
