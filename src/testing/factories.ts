/**
 * Shared test fixture factories for vex.
 *
 * Canonical factories for core domain types used across test files.
 * Each factory accepts a Partial<T> spread override for per-test customization.
 */

import type { CodeLocation, Issue, ViewportConfig } from "../core/types.js";
import type { LoopOptions } from "../loop/types.js";
import type { PipelineDefinition, PipelineState } from "../pipeline/types.js";

export function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    description: "Test issue",
    severity: "medium",
    region: "A1",
    ...overrides,
  };
}

export function createCodeLocation(overrides: Partial<CodeLocation> = {}): CodeLocation {
  return {
    file: "test.liquid",
    confidence: "high",
    reasoning: "Test location",
    strategy: "test",
    ...overrides,
  };
}

export function createPipelineDefinition(
  overrides: Partial<PipelineDefinition> = {},
): PipelineDefinition {
  return {
    name: "test-pipeline",
    description: "Test pipeline",
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

export function createPipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    definition: createPipelineDefinition(),
    sessionDir: "/tmp/test-session",
    startedAt: new Date().toISOString(),
    status: "completed",
    nodes: {},
    artifacts: {},
    data: {},
    issues: [],
    semanticNames: {},
    ...overrides,
  };
}

export const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

export function createLoopOptions(overrides: Partial<LoopOptions> = {}): LoopOptions {
  return {
    url: "https://example.com",
    maxIterations: 5,
    viewports: [DEFAULT_VIEWPORT],
    provider: "test",
    projectRoot: "/tmp/test",
    interactive: false,
    autoFixThreshold: "high",
    ...overrides,
  };
}
