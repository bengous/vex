/**
 * Unit tests for analyze operation.
 *
 * Tests VLM-powered image analysis with mock provider.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import sharp from 'sharp';
import { registerProvider, unregisterProvider } from '../../providers/index.js';
import {
  createCapturingLogger,
  createMockAnalysisError,
  createMockContext,
  createMockImageArtifact,
  createMockVisionProviderLayer,
  createMockVisionResult,
  expectOperationFailure,
  runEffectExit,
} from '../../testing/index.js';
import { analyzeOperation } from './analyze.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('analyzeOperation', () => {
  let testDir: string;
  let testImagePath: string;
  const registeredProviders: string[] = [];

  beforeAll(async () => {
    testDir = join(tmpdir(), `analyze-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create a simple test image (400x400 white square)
    testImagePath = join(testDir, 'test-input.png');
    await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toFile(testImagePath);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
    // Clean up registered mock providers
    for (const name of registeredProviders) {
      unregisterProvider(name);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test Fixtures
  // ═══════════════════════════════════════════════════════════════════════════

  /** Register a mock provider and track for cleanup */
  function registerMockProvider(name: string, options: Parameters<typeof createMockVisionProviderLayer>[0]) {
    registerProvider(name, () => createMockVisionProviderLayer(options));
    registeredProviders.push(name);
    return name;
  }

  function createIssuesResponse(issues: object[] = []): string {
    return JSON.stringify({ issues });
  }

  function createTestIssue(id: number, severity: 'high' | 'medium' | 'low' = 'medium') {
    return {
      id,
      description: `Test issue ${id}`,
      severity,
      region: 'A1',
      suggestedFix: 'Fix it',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Success Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('success paths', () => {
    test('returns analysis artifact on successful response', async () => {
      const providerName = `test-analyze-success-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse([]),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.analysis.type).toBe('analysis');
        expect(exit.value.analysis.createdBy).toBe('analyze');
      }
    });

    test('parses issues from VLM JSON response', async () => {
      const providerName = `test-analyze-parse-${Date.now()}`;
      const issues = [createTestIssue(1, 'high'), createTestIssue(2, 'medium')];
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse(issues),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.result.issues.length).toBe(2);
        expect(exit.value.result.issues[0]?.severity).toBe('high');
        expect(exit.value.analysis.metadata.issueCount).toBe(2);
      }
    });

    test('stores artifact in context', async () => {
      const providerName = `test-analyze-store-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse([]),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.analysis.id);
        expect(storedArtifact).toBeDefined();
        expect(storedArtifact?.id).toBe(exit.value.analysis.id);
      }
    });

    test('logs analysis progress', async () => {
      const providerName = `test-analyze-log-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse([]),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.some((m) => m.message.includes(providerName))).toBe(true);
    });

    test('includes provider and model in result metadata', async () => {
      const providerName = `test-analyze-meta-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        model: 'test-model-v1',
        durationMs: 250,
        response: createIssuesResponse([]),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.analysis.metadata.provider).toBe(providerName);
        expect(exit.value.analysis.metadata.model).toBe('test-model-v1');
        expect(exit.value.analysis.metadata.durationMs).toBe(250);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when provider not found', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: 'nonexistent-provider-xyz' }, ctx));

      const error = expectOperationFailure(exit, 'analyze');
      expect(error.detail).toContain('Provider error');
    });

    test('fails when analysis fails', async () => {
      const providerName = `test-analyze-fail-${Date.now()}`;
      const mockError = createMockAnalysisError({
        provider: providerName,
        kind: 'execution',
        message: 'Model overloaded',
      });
      registerMockProvider(providerName, { analyzeResponse: mockError });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      const error = expectOperationFailure(exit, 'analyze');
      expect(error.detail).toContain('Analysis failed');
    });

    test('rejects reasoning on unsupported providers', async () => {
      const providerName = `test-analyze-reasoning-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse([]),
      });
      registerMockProvider(providerName, { analyzeResponse: mockResult });

      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(
        analyzeOperation.execute(input, { provider: providerName, reasoning: 'medium' }, ctx),
      );

      const error = expectOperationFailure(exit, 'analyze');
      expect(error.detail).toContain('does not support --reasoning');
      expect(error.detail).toContain('codex-cli');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Viewport Context Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('viewport context', () => {
    test('includes viewport info in prompt when present', async () => {
      const providerName = `test-analyze-viewport-${Date.now()}`;
      const mockResult = createMockVisionResult({
        provider: providerName,
        response: createIssuesResponse([]),
      });

      let capturedPrompt: string | undefined;
      registerMockProvider(providerName, {
        analyzeResponse: mockResult,
        onAnalyze: (_images, prompt) => {
          capturedPrompt = prompt;
        },
      });

      const viewport = { width: 375, height: 812, deviceScaleFactor: 3, isMobile: true };
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, viewport }) };

      const exit = await runEffectExit(analyzeOperation.execute(input, { provider: providerName }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(capturedPrompt).toBeDefined();
      expect(capturedPrompt).toContain('375×812px');
      expect(capturedPrompt).toContain('mobile');
    });
  });
});
