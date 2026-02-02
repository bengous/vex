/**
 * Unit tests for annotate operation.
 *
 * Tests annotation tool call generation from analysis results.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import type { AnalysisResult, Issue, ToolCall } from '../../core/types.js';
import { registerProvider } from '../../providers/index.js';
import { createMockAnalysisError, createMockVisionProviderLayer, createMockVisionResult, expectOperationFailure, runEffectExit } from '../../testing/index.js';
import { createCapturingLogger, createMockContext } from '../../testing/mocks/pipeline-context.js';
import { annotateOperation } from './annotate.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('annotateOperation', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `annotate-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test Fixtures
  // ═══════════════════════════════════════════════════════════════════════════

  function createMockIssue(overrides: Partial<Issue> = {}): Issue {
    return {
      id: 1,
      description: 'Test issue',
      severity: 'medium',
      region: 'A1',
      suggestedFix: 'Fix it',
      ...overrides,
    };
  }

  function createMockAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
    return {
      provider: 'test-provider',
      model: 'test-model',
      response: '{}',
      durationMs: 100,
      issues: [],
      ...overrides,
    };
  }

  function createToolCallsResponse(toolCalls: object[]): string {
    return JSON.stringify(toolCalls);
  }

  function createValidToolCall(tool: ToolCall['tool'] = 'draw_rectangle'): object {
    switch (tool) {
      case 'draw_rectangle':
        return { tool: 'draw_rectangle', params: { start: 'A1', end: 'B2', style: 'error', label: 'Issue' } };
      case 'draw_arrow':
        return { tool: 'draw_arrow', params: { from: 'A1', to: 'C3', style: 'warning', label: 'Flow' } };
      case 'add_label':
        return { tool: 'add_label', params: { cell: 'B2', text: 'Label', style: 'info' } };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Success Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('success paths', () => {
    test('generates tool calls from issues', async () => {
      const providerName = `test-annotate-success-${Date.now()}`;
      const toolCalls = [createValidToolCall('draw_rectangle'), createValidToolCall('add_label')];
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createToolCallsResponse(toolCalls),
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({
          issues: [createMockIssue({ id: 1 }), createMockIssue({ id: 2, severity: 'high' })],
        }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.toolCalls.length).toBe(2);
        expect(exit.value.toolCalls[0]?.tool).toBe('draw_rectangle');
        expect(exit.value.toolCalls[1]?.tool).toBe('add_label');
      }
    });

    test('stores annotations artifact', async () => {
      const providerName = `test-annotate-store-${Date.now()}`;
      const toolCalls = [createValidToolCall()];
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createToolCallsResponse(toolCalls),
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.annotations.id);
        expect(storedArtifact).toBeDefined();
        expect(exit.value.annotations.type).toBe('annotations');
        expect(exit.value.annotations.createdBy).toBe('annotate');
      }
    });

    test('returns empty toolCalls when no issues', async () => {
      const providerName = `test-annotate-empty-${Date.now()}`;
      // Provider should not even be called when issues is empty
      registerProvider(providerName, () =>
        createMockVisionProviderLayer({
          analyzeResponse: createMockVisionResult({ response: '[]' }),
        }),
      );

      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = {
        result: createMockAnalysisResult({ issues: [] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.toolCalls.length).toBe(0);
        expect(exit.value.annotations.metadata.toolCallCount).toBe(0);
      }

      // Should log that there are no issues to annotate
      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.some((m) => m.message.includes('No issues'))).toBe(true);
    });

    test('logs annotation progress', async () => {
      const providerName = `test-annotate-log-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createToolCallsResponse([createValidToolCall()]),
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.some((m) => m.message.includes('Generating annotations'))).toBe(true);
      expect(infoMessages.some((m) => m.message.includes('Generated'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Graceful Degradation Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('graceful degradation', () => {
    test('returns empty array for malformed response', async () => {
      const providerName = `test-annotate-malformed-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: 'This is not valid JSON at all!!!',
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      // Should succeed but with empty tool calls (graceful degradation)
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.toolCalls.length).toBe(0);
      }
    });

    test('filters invalid tool types', async () => {
      const providerName = `test-annotate-filter-${Date.now()}`;
      const mixedToolCalls = [
        createValidToolCall('draw_rectangle'),
        { tool: 'invalid_tool', params: {} },
        createValidToolCall('add_label'),
        { tool: 'another_invalid', params: { foo: 'bar' } },
      ];
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createToolCallsResponse(mixedToolCalls),
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // Only valid tool types should remain
        expect(exit.value.toolCalls.length).toBe(2);
        expect(
          exit.value.toolCalls.every((tc) => ['draw_rectangle', 'draw_arrow', 'add_label'].includes(tc.tool)),
        ).toBe(true);
      }
    });

    test('handles JSON array embedded in prose', async () => {
      const providerName = `test-annotate-embedded-${Date.now()}`;
      const embeddedResponse = `Here are the annotations:
[${JSON.stringify(createValidToolCall('draw_rectangle'))}, ${JSON.stringify(createValidToolCall('add_label'))}]
Let me know if you need more.`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: embeddedResponse,
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.toolCalls.length).toBe(2);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when provider not found', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: 'nonexistent-provider-abc' }, ctx));

      const error = expectOperationFailure(exit, 'annotate');
      expect(error.detail).toContain('Provider error');
    });

    test('fails when provider fails', async () => {
      const providerName = `test-annotate-fail-${Date.now()}`;
      const mockError = createMockAnalysisError({
        provider: providerName,
        kind: 'timeout',
        message: 'Request timed out',
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockError }));

      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        result: createMockAnalysisResult({ issues: [createMockIssue()] }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      const error = expectOperationFailure(exit, 'annotate');
      expect(error.detail).toContain('Annotation generation failed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metadata Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('artifact metadata', () => {
    test('includes correct issue and tool call counts', async () => {
      const providerName = `test-annotate-meta-${Date.now()}`;
      const toolCalls = [createValidToolCall('draw_rectangle'), createValidToolCall('add_label')];
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createToolCallsResponse(toolCalls),
      });
      registerProvider(providerName, () => createMockVisionProviderLayer({ analyzeResponse: mockResult }));

      const ctx = createMockContext({ sessionDir: testDir });
      const issues = [createMockIssue({ id: 1 }), createMockIssue({ id: 2 }), createMockIssue({ id: 3 })];
      const input = {
        result: createMockAnalysisResult({ issues }),
      };

      const exit = await runEffectExit(annotateOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.annotations.metadata.issueCount).toBe(3);
        expect(exit.value.annotations.metadata.toolCallCount).toBe(2);
      }
    });
  });
});
