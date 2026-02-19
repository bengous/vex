import { describe, expect, test } from 'bun:test';
import type { ViewportConfig } from '../../core/types.js';
import type { LoopOptions } from '../../loop/types.js';
import { createGateConfigFromLoopOptions } from './loop.js';

const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

function createLoopOptions(autoFixThreshold: LoopOptions['autoFixThreshold']): LoopOptions {
  return {
    url: 'https://example.com',
    maxIterations: 3,
    interactive: false,
    autoFixThreshold,
    viewports: [DEFAULT_VIEWPORT],
    provider: 'ollama',
    model: 'qwen3-vl:8b',
    sessionDir: '/tmp/test-loop-session',
    projectRoot: '/tmp/test-project',
    dryRun: true,
  };
}

describe('createGateConfigFromLoopOptions', () => {
  test.each(['high', 'medium', 'none'] as const)('maps autoFixThreshold=%s to gate autoFixConfidence', (threshold) => {
    const loopOptions = createLoopOptions(threshold);

    const gateConfig = createGateConfigFromLoopOptions(loopOptions);

    expect(gateConfig).toEqual({
      autoFixConfidence: threshold,
    });
  });
});
