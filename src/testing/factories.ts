/**
 * Shared test fixture factories for vex.
 *
 * Canonical factories for core domain types used across test files.
 * Each factory accepts a Partial<T> spread override for per-test customization.
 */

import type { ValidRunSpec } from "../cli/audit/plan.js";
import type { AuditManifest } from "../cli/scan-layout.js";
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
    outputs: {},
    issues: [],
    ...overrides,
  };
}

const DEFAULT_VIEWPORT: ViewportConfig = {
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

export function createAuditManifest(overrides: Partial<AuditManifest> = {}): AuditManifest {
  return {
    type: "vex-audit",
    auditId: "audit-test",
    status: "running",
    startedAt: "2026-04-24T00:00:00.000Z",
    outputDir: "/tmp/audit-test",
    provider: "codex-cli",
    model: "gpt-5.4",
    reasoning: "low",
    urls: ["https://example.com"],
    devices: ["desktop-1920"],
    mode: "analyze",
    full: false,
    foldOcclusion: false,
    placeholderMedia: false,
    fullPageScrollFix: false,
    totalRuns: 1,
    completedRuns: 0,
    failedRuns: 0,
    runs: [],
    ...overrides,
  };
}

export function createRunSpec(overrides: Partial<ValidRunSpec> = {}): ValidRunSpec {
  return {
    kind: "valid",
    url: "https://example.com",
    deviceId: "desktop-1920",
    viewport: DEFAULT_VIEWPORT,
    pageDir: "/tmp/audit-test/pages/example.com/_index",
    pagePath: "pages/example.com/_index",
    viewportDir: "/tmp/audit-test/pages/example.com/_index/desktop-1920",
    viewportPath: "pages/example.com/_index/desktop-1920",
    viewportDirName: "desktop-1920",
    ...overrides,
  };
}
