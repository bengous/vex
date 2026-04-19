/**
 * E2E smoke tests for VEX pipeline.
 *
 * Tests the full pipeline: capture -> folds -> grid -> analyze
 * using real VLM providers with a fallback chain.
 *
 * These tests verify:
 * - Pipeline completes successfully
 * - All expected artifacts are created
 * - Analysis JSON has valid structure
 *
 * Note: VLM issue detection is non-deterministic, so we don't assert
 * specific issues are found. The test page has deliberate visual problems,
 * but detection depends on model, prompt, and image quality.
 *
 * Provider fallback order (first available wins):
 * 1. gemini-cli + gemini-2.5-flash (cheapest, fast)
 * 2. codex-cli + gpt-5.4 with reasoning: 'low' (best at visuals)
 * 3. ollama + qwen3-vl:8b (free, local)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, Exit } from 'effect';
import { runEffectExit } from '../testing/effect-helpers.js';

import '../providers/init.js'; // Register all providers
import { ARTIFACT_NAMES, getViewportDirName, type ViewportConfig } from '../core/types.js';
import { simpleAnalysis } from '../pipeline/presets.js';
import { runPipeline } from '../pipeline/runtime.js';
import type { PipelineState } from '../pipeline/types.js';
import { getProviderInfo } from '../providers/shared/introspection.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Configuration
// ═══════════════════════════════════════════════════════════════════════════

const DESKTOP_VIEWPORT: ViewportConfig = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  isMobile: false,
};

interface ProviderConfig {
  name: string;
  model: string;
  reasoning?: string;
}

// Note: gemini-cli's @file syntax doesn't work for images, so codex-cli is preferred
const PROVIDER_CHAIN: readonly ProviderConfig[] = [
  { name: 'codex-cli', model: 'gpt-5.4', reasoning: 'low' },
  { name: 'ollama', model: 'qwen3-vl:8b' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Provider Discovery
// ═══════════════════════════════════════════════════════════════════════════

async function findAvailableProvider(): Promise<ProviderConfig | null> {
  for (const provider of PROVIDER_CHAIN) {
    const info = await Effect.runPromise(getProviderInfo(provider.name));
    if (info?.available) {
      return provider;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface ValidationResult {
  state: PipelineState;
  analysis: { provider: string; issues: Array<{ severity: string; description: string }> };
}

async function runAndValidate(
  testUrl: string,
  viewport: ViewportConfig,
  provider: ProviderConfig,
  outputDir: string,
): Promise<ValidationResult> {
  const pipeline = simpleAnalysis(testUrl, viewport, provider.name, provider.model, provider.reasoning);

  const exit = await runEffectExit(runPipeline(pipeline, outputDir));

  expect(Exit.isSuccess(exit)).toBe(true);
  if (!Exit.isSuccess(exit)) {
    throw new Error(`Pipeline failed: ${JSON.stringify(exit.cause)}`);
  }

  const state = exit.value;
  const viewportDir = join(state.sessionDir, getViewportDirName(viewport));

  // Verify pipeline completed successfully
  expect(state.status).toBe('completed');

  // Verify all nodes completed
  for (const [nodeId, node] of Object.entries(state.nodes)) {
    expect(node.status, `Node ${nodeId} should be completed`).toBe('completed');
  }

  // Verify artifacts exist
  expect(existsSync(join(viewportDir, ARTIFACT_NAMES.screenshot))).toBe(true);
  expect(existsSync(join(viewportDir, ARTIFACT_NAMES.withFolds))).toBe(true);
  expect(existsSync(join(viewportDir, ARTIFACT_NAMES.withGrid))).toBe(true);
  expect(existsSync(join(viewportDir, ARTIFACT_NAMES.analysis))).toBe(true);
  expect(existsSync(join(state.sessionDir, 'state.json'))).toBe(true);

  // Parse and validate analysis JSON structure
  const analysisContent = await Bun.file(join(viewportDir, ARTIFACT_NAMES.analysis)).json();
  expect(analysisContent).toHaveProperty('provider', provider.name);
  expect(analysisContent).toHaveProperty('issues');
  expect(Array.isArray(analysisContent.issues)).toBe(true);

  // Note: We don't assert issues.length >= 1 because VLM detection is non-deterministic.
  // The test page has deliberate visual problems, but detection depends on model quality.

  return { state, analysis: analysisContent };
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('VEX Pipeline E2E', () => {
  let outputDir: string;
  let provider: ProviderConfig | null;
  const testUrl = `file://${resolve(import.meta.dir, 'fixtures/test-page.html')}`;

  beforeAll(async () => {
    if (!process.env.RUN_E2E) return;
    outputDir = mkdtempSync(join(tmpdir(), 'vex-e2e-'));
    provider = await findAvailableProvider();
  });

  afterAll(async () => {
    if (!process.env.RUN_E2E) return;
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!process.env.RUN_E2E)(
    'full pipeline: capture -> folds -> grid -> analyze',
    async () => {
      if (!provider) {
        console.log('SKIP: No VLM provider available');
        return;
      }
      console.log(`Provider: ${provider.name} (${provider.model})`);

      const { analysis } = await runAndValidate(testUrl, DESKTOP_VIEWPORT, provider, outputDir);

      // Log detected issues for debugging
      console.log(`Issues found: ${analysis.issues.length}`);
      for (const issue of analysis.issues) {
        console.log(`  - [${issue.severity}] ${issue.description}`);
      }
    },
    // Allow 90s: ~5s browser startup + ~5s capture + ~2s overlays + ~45s VLM + buffer
    { timeout: 90_000 },
  );
});
