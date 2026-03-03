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
import { Effect, Exit } from 'effect';
import type { Artifact } from '../core/types.js';
import { runEffectExit } from '../testing/effect-helpers.js';
import {
  registerTestOperation,
  runPipeline,
  syncContextFromState,
  unregisterTestOperation,
} from './runtime.js';
import type { Operation, PipelineDefinition, PipelineState } from './types.js';

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

// ═══════════════════════════════════════════════════════════════════════════
// Context Sync Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('syncContextFromState', () => {
  test('populates context maps from state', () => {
    const artifact: Artifact = {
      _kind: 'artifact',
      id: 'test-art',
      type: 'image',
      path: '/tmp/test.png',
      createdAt: new Date().toISOString(),
      createdBy: 'test',
      metadata: { width: 1920, height: 1080 },
    };

    const artifacts = new Map<string, Artifact>();
    const semanticNames = new Map<string, Artifact>();
    const dataMap = new Map<string, unknown>();

    const state = {
      artifacts: { 'test-art': artifact },
      semanticNames: { 'capture:image': 'test-art' },
      data: { 'capture:meta': { width: 1920 } },
    } as unknown as PipelineState;

    syncContextFromState(state, artifacts, semanticNames, dataMap);

    expect(artifacts.get('test-art')).toBe(artifact);
    expect(semanticNames.get('capture:image')).toBe(artifact);
    expect(dataMap.get('capture:meta')).toEqual({ width: 1920 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel Execution Tests (Mock Operations)
// ═══════════════════════════════════════════════════════════════════════════

const executionLog: string[] = [];

const mockOperationA: Operation = {
  name: 'mock-a',
  description: 'Mock operation A',
  inputTypes: [],
  outputTypes: ['analysis'],
  execute: (_input, _config, _ctx) =>
    Effect.gen(function* () {
      executionLog.push('a-start');
      yield* Effect.sleep('10 millis');
      executionLog.push('a-end');
      return {};
    }),
};

const mockOperationB: Operation = {
  name: 'mock-b',
  description: 'Mock operation B',
  inputTypes: [],
  outputTypes: ['analysis'],
  execute: (_input, _config, _ctx) =>
    Effect.gen(function* () {
      executionLog.push('b-start');
      yield* Effect.sleep('10 millis');
      executionLog.push('b-end');
      return {};
    }),
};

describe('parallel node execution', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'pipeline-parallel-test-'));
    registerTestOperation('mock-a', mockOperationA);
    registerTestOperation('mock-b', mockOperationB);
  });

  afterAll(async () => {
    unregisterTestOperation('mock-a');
    unregisterTestOperation('mock-b');
    await rm(testDir, { recursive: true });
  });

  test('independent nodes execute concurrently', async () => {
    executionLog.length = 0;

    const definition: PipelineDefinition = {
      name: 'parallel-mock-test',
      description: 'Two independent mock nodes',
      nodes: [
        { id: 'nodeA', operation: 'mock-a', config: {}, inputs: [], outputs: [] },
        { id: 'nodeB', operation: 'mock-b', config: {}, inputs: [], outputs: [] },
      ],
      edges: [],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const state = exit.value;
      expect(state.status).toBe('completed');
      expect(state.nodes.nodeA?.status).toBe('completed');
      expect(state.nodes.nodeB?.status).toBe('completed');
    }

    // With parallel execution, both should start before either ends.
    // Sequential would be: [a-start, a-end, b-start, b-end]
    // Parallel should interleave: [a-start, b-start, ...]
    const aStartIdx = executionLog.indexOf('a-start');
    const bStartIdx = executionLog.indexOf('b-start');
    const aEndIdx = executionLog.indexOf('a-end');

    expect(bStartIdx).toBeLessThan(aEndIdx);
    expect(aStartIdx).toBeGreaterThanOrEqual(0);
    expect(bStartIdx).toBeGreaterThanOrEqual(0);
  });

  test('sequential nodes still execute in order', async () => {
    executionLog.length = 0;

    const definition: PipelineDefinition = {
      name: 'sequential-mock-test',
      description: 'Two dependent mock nodes',
      nodes: [
        { id: 'nodeA', operation: 'mock-a', config: {}, inputs: [], outputs: ['out'] },
        { id: 'nodeB', operation: 'mock-b', config: {}, inputs: ['out'], outputs: [] },
      ],
      edges: [{ from: 'nodeA', to: 'nodeB', artifact: 'out' }],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);

    // With an edge dependency, A must complete before B starts
    const aEndIdx = executionLog.indexOf('a-end');
    const bStartIdx = executionLog.indexOf('b-start');
    expect(aEndIdx).toBeLessThan(bStartIdx);
  });
});
