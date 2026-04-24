/**
 * Unit tests for pipeline state merge logic.
 */

import type { Issue } from "../core/types.js";
import type { NodeResult } from "./state.js";
import type { PipelineState } from "./types.js";
import { describe, expect, test } from "bun:test";
import {
  createIssue,
  createPipelineDefinition,
  createPipelineState,
} from "../testing/factories.js";
import { createMockImageArtifact } from "../testing/mocks/pipeline-context.js";
import { mergeNodeResults } from "./state.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const testDefinition = createPipelineDefinition({
  nodes: [
    { id: "a", operation: "capture", config: {}, inputs: [], outputs: [] },
    { id: "b", operation: "capture", config: {}, inputs: [], outputs: [] },
  ],
});

function createBaseState(overrides: Partial<PipelineState> = {}): PipelineState {
  return createPipelineState({
    definition: testDefinition,
    status: "running",
    nodes: {
      a: { id: "a", status: "pending", outputArtifacts: [] },
      b: { id: "b", status: "pending", outputArtifacts: [] },
    },
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// mergeNodeResults
// ═══════════════════════════════════════════════════════════════════════════

describe("mergeNodeResults", () => {
  test("merges two node results with disjoint artifacts", () => {
    const base = createBaseState();
    const artA = createMockImageArtifact({ id: "art-a", path: "/tmp/art-a.png" });
    const artB = createMockImageArtifact({ id: "art-b", path: "/tmp/art-b.png" });

    const resultA: NodeResult = {
      nodeId: "a",
      artifacts: [artA],
      state: {
        ...base,
        nodes: { ...base.nodes, a: { id: "a", status: "completed", outputArtifacts: ["art-a"] } },
        artifacts: { [artA.id]: artA },
        outputs: {
          "a:image": { channel: "artifact", artifactId: artA.id, type: "image" },
          "a:meta": { channel: "data", value: { width: 1920 } },
        },
      },
    };

    const resultB: NodeResult = {
      nodeId: "b",
      artifacts: [artB],
      state: {
        ...base,
        nodes: { ...base.nodes, b: { id: "b", status: "completed", outputArtifacts: ["art-b"] } },
        artifacts: { [artB.id]: artB },
        outputs: {
          "b:image": { channel: "artifact", artifactId: artB.id, type: "image" },
          "b:meta": { channel: "data", value: { width: 375 } },
        },
      },
    };

    const merged = mergeNodeResults(base, [resultA, resultB]);

    expect(merged.nodes["a"]?.status).toBe("completed");
    expect(merged.nodes["b"]?.status).toBe("completed");

    expect(merged.artifacts["art-a"]).toBeDefined();
    expect(merged.artifacts["art-b"]).toBeDefined();

    expect(merged.outputs["a:image"]).toEqual({
      channel: "artifact",
      artifactId: "art-a",
      type: "image",
    });
    expect(merged.outputs["b:image"]).toEqual({
      channel: "artifact",
      artifactId: "art-b",
      type: "image",
    });

    expect(merged.outputs["a:meta"]).toEqual({ channel: "data", value: { width: 1920 } });
    expect(merged.outputs["b:meta"]).toEqual({ channel: "data", value: { width: 375 } });
  });

  test("single result returns that result state directly", () => {
    const base = createBaseState();
    const artA = createMockImageArtifact({ id: "art-a", path: "/tmp/art-a.png" });

    const result: NodeResult = {
      nodeId: "a",
      artifacts: [artA],
      state: {
        ...base,
        nodes: { ...base.nodes, a: { id: "a", status: "completed", outputArtifacts: ["art-a"] } },
        artifacts: { [artA.id]: artA },
        outputs: { "a:image": { channel: "artifact", artifactId: artA.id, type: "image" } },
      },
    };

    const merged = mergeNodeResults(base, [result]);
    expect(merged).toEqual(result.state);
  });

  test("preserves base state fields not modified by nodes", () => {
    const base = createBaseState({
      status: "running",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const result: NodeResult = {
      nodeId: "a",
      artifacts: [],
      state: {
        ...base,
        nodes: { ...base.nodes, a: { id: "a", status: "completed", outputArtifacts: [] } },
      },
    };

    const merged = mergeNodeResults(base, [result]);
    expect(merged.status).toBe("running");
    expect(merged.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(merged.sessionDir).toBe("/tmp/test-session");
  });

  test("merges issues from analyze nodes", () => {
    const base = createBaseState();
    const issues: Issue[] = [createIssue()];

    const resultA: NodeResult = {
      nodeId: "a",
      artifacts: [],
      state: {
        ...base,
        issues,
        nodes: { ...base.nodes, a: { id: "a", status: "completed", outputArtifacts: [] } },
      },
    };

    const resultB: NodeResult = {
      nodeId: "b",
      artifacts: [],
      state: {
        ...base,
        nodes: { ...base.nodes, b: { id: "b", status: "completed", outputArtifacts: [] } },
      },
    };

    const merged = mergeNodeResults(base, [resultA, resultB]);
    expect(merged.issues).toEqual(issues);
  });

  test("concatenates issues from multiple results", () => {
    const base = createBaseState();
    const issueA = createIssue({ id: 1, description: "Issue from A" });
    const issueB = createIssue({ id: 2, description: "Issue from B" });

    const resultA: NodeResult = {
      nodeId: "a",
      artifacts: [],
      state: {
        ...base,
        issues: [issueA],
        nodes: { ...base.nodes, a: { id: "a", status: "completed", outputArtifacts: [] } },
      },
    };

    const resultB: NodeResult = {
      nodeId: "b",
      artifacts: [],
      state: {
        ...base,
        issues: [issueB],
        nodes: { ...base.nodes, b: { id: "b", status: "completed", outputArtifacts: [] } },
      },
    };

    const merged = mergeNodeResults(base, [resultA, resultB]);
    expect(merged.issues).toHaveLength(2);
    expect(merged.issues).toContainEqual(issueA);
    expect(merged.issues).toContainEqual(issueB);
  });
});
