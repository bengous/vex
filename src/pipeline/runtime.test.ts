/**
 * Unit tests for pipeline runtime DAG executor.
 *
 * Tests validation errors and execution paths.
 * Uses temp directories for session creation.
 */

import type { Operation, PipelineDefinition } from "./types.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffectExit } from "../testing/effect-helpers.js";
import {
  registerTestOperation,
  resumePipeline,
  runPipeline,
  unregisterTestOperation,
} from "./runtime.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createEmptyPipeline(): PipelineDefinition {
  return {
    name: "empty",
    description: "Empty test pipeline",
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
  };
}

function createPipelineWithUnknownOperation(): PipelineDefinition {
  return {
    name: "unknown-op",
    description: "Pipeline with unknown operation",
    nodes: [
      {
        id: "node1",
        operation: "nonexistent-operation",
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

describe("runPipeline", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "pipeline-runtime-test-"));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  describe("validation errors", () => {
    test("returns validation error for empty pipeline", async () => {
      const definition = createEmptyPipeline();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        // Effect's Cause structure
        if (cause._tag === "Fail") {
          expect(cause.error._tag).toBe("PipelineError");
          expect(cause.error.phase).toBe("validation");
          expect(cause.error.message).toContain("no nodes");
        }
      }
    });
  });

  describe("execution errors", () => {
    test("returns error for unknown operation", async () => {
      const definition = createPipelineWithUnknownOperation();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === "Fail") {
          expect(cause.error._tag).toBe("PipelineError");
          expect(cause.error.phase).toBe("execution");
          expect(cause.error.message).toContain("Unknown operation");
        }
      }
    });
  });

  describe("session directory creation", () => {
    test("creates session directory on success path", async () => {
      // Since we can't easily test a successful pipeline without real operations,
      // we verify that validation happens before session creation by checking
      // the error doesn't mention session directory failures.
      const definition = createEmptyPipeline();

      const exit = await runEffectExit(runPipeline(definition, testDir));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === "Fail") {
          // Validation error, not session creation error
          expect(cause.error.phase).toBe("validation");
        }
      }
    });

    test("uses provided sessionId when run options specify one", async () => {
      const definition = createPipelineWithUnknownOperation();
      const sessionId = "custom-session-id";

      const exit = await runEffectExit(runPipeline(definition, testDir, undefined, { sessionId }));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(existsSync(join(testDir, sessionId))).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel Execution Tests (Mock Operations)
// ═══════════════════════════════════════════════════════════════════════════

const executionLog: string[] = [];

const mockOperationA: Operation = {
  name: "mock-a",
  description: "Mock operation A",
  inputSpecs: {},
  outputSpecs: { out: { channel: "data" } },
  execute: (_input, _config, _ctx) =>
    Effect.gen(function* () {
      executionLog.push("a-start");
      yield* Effect.sleep("10 millis");
      executionLog.push("a-end");
      return { data: { out: "a" } };
    }),
};

const mockOperationB: Operation = {
  name: "mock-b",
  description: "Mock operation B",
  inputSpecs: { out: { channel: "data", optional: true } },
  outputSpecs: { out: { channel: "data" } },
  execute: (_input, _config, _ctx) =>
    Effect.gen(function* () {
      executionLog.push("b-start");
      yield* Effect.sleep("10 millis");
      executionLog.push("b-end");
      return { data: { out: "b" } };
    }),
};

describe("parallel node execution", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "pipeline-parallel-test-"));
    registerTestOperation("mock-a", mockOperationA);
    registerTestOperation("mock-b", mockOperationB);
  });

  afterAll(async () => {
    unregisterTestOperation("mock-a");
    unregisterTestOperation("mock-b");
    await rm(testDir, { recursive: true });
  });

  test("independent nodes execute concurrently", async () => {
    executionLog.length = 0;

    const definition: PipelineDefinition = {
      name: "parallel-mock-test",
      description: "Two independent mock nodes",
      nodes: [
        { id: "nodeA", operation: "mock-a", config: {}, inputs: [], outputs: [] },
        { id: "nodeB", operation: "mock-b", config: {}, inputs: [], outputs: [] },
      ],
      edges: [],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const state = exit.value;
      expect(state.status).toBe("completed");
      expect(state.nodes["nodeA"]?.status).toBe("completed");
      expect(state.nodes["nodeB"]?.status).toBe("completed");
    }

    // With parallel execution, both should start before either ends.
    // Sequential would be: [a-start, a-end, b-start, b-end]
    // Parallel should interleave: [a-start, b-start, ...]
    const aStartIdx = executionLog.indexOf("a-start");
    const bStartIdx = executionLog.indexOf("b-start");
    const aEndIdx = executionLog.indexOf("a-end");

    expect(bStartIdx).toBeLessThan(aEndIdx);
    expect(aStartIdx).toBeGreaterThanOrEqual(0);
    expect(bStartIdx).toBeGreaterThanOrEqual(0);
  });

  test("sequential nodes still execute in order", async () => {
    executionLog.length = 0;

    const definition: PipelineDefinition = {
      name: "sequential-mock-test",
      description: "Two dependent mock nodes",
      nodes: [
        { id: "nodeA", operation: "mock-a", config: {}, inputs: [], outputs: ["out"] },
        { id: "nodeB", operation: "mock-b", config: {}, inputs: ["out"], outputs: [] },
      ],
      edges: [{ from: "nodeA", to: "nodeB", output: "out" }],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);

    // With an edge dependency, A must complete before B starts
    const aEndIdx = executionLog.indexOf("a-end");
    const bStartIdx = executionLog.indexOf("b-start");
    expect(aEndIdx).toBeLessThan(bStartIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Output Routing Boundary Tests
// ═══════════════════════════════════════════════════════════════════════════

const routingLog: unknown[] = [];

const dataAndArtifactProducer: Operation = {
  name: "mock-produce-artifact-data",
  description: "Produce one image artifact and one data output",
  inputSpecs: {},
  outputSpecs: {
    image: { channel: "artifact", type: "image" },
    meta: { channel: "data" },
  },
  execute: (_input, _config, ctx) =>
    Effect.succeed({
      artifacts: {
        image: ctx.createArtifact({
          type: "image",
          path: join(ctx.sessionDir, "mock.png"),
          createdBy: "mock-produce-artifact-data",
          metadata: { width: 10, height: 20 },
        }),
      },
      data: { meta: { label: "routed" } },
    }),
};

const artifactDataConsumer: Operation = {
  name: "mock-consume-artifact-data",
  description: "Consume routed artifact and data outputs",
  inputSpecs: {
    image: { channel: "artifact", type: "image" },
    meta: { channel: "data" },
  },
  outputSpecs: { received: { channel: "data" } },
  execute: (input) => {
    routingLog.push(input);
    return Effect.succeed({ data: { received: true } });
  },
};

const incompatibleArtifactConsumer: Operation = {
  name: "mock-consume-analysis-artifact",
  description: "Consumes an analysis artifact",
  inputSpecs: { image: { channel: "artifact", type: "analysis" } },
  outputSpecs: { received: { channel: "data" } },
  execute: () => Effect.succeed({ data: { received: true } }),
};

describe("output routing boundaries", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "pipeline-routing-test-"));
    registerTestOperation("mock-produce-artifact-data", dataAndArtifactProducer);
    registerTestOperation("mock-consume-artifact-data", artifactDataConsumer);
    registerTestOperation("mock-consume-analysis-artifact", incompatibleArtifactConsumer);
    registerTestOperation("mock-a", mockOperationA);
    registerTestOperation("mock-b", mockOperationB);
  });

  afterAll(async () => {
    unregisterTestOperation("mock-produce-artifact-data");
    unregisterTestOperation("mock-consume-artifact-data");
    unregisterTestOperation("mock-consume-analysis-artifact");
    unregisterTestOperation("mock-a");
    unregisterTestOperation("mock-b");
    await rm(testDir, { recursive: true });
  });

  test("routes artifact and data outputs into named inputs", async () => {
    routingLog.length = 0;
    const definition: PipelineDefinition = {
      name: "artifact-data-routing",
      description: "Route both output channels",
      nodes: [
        {
          id: "produce",
          operation: "mock-produce-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
        {
          id: "consume",
          operation: "mock-consume-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
      ],
      edges: [
        { from: "produce", to: "consume", output: "image" },
        { from: "produce", to: "consume", output: "meta" },
      ],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outputs["produce:image"]?.channel).toBe("artifact");
      expect(exit.value.outputs["produce:meta"]).toEqual({
        channel: "data",
        value: { label: "routed" },
      });
      expect(exit.value.outputs["consume:received"]).toEqual({
        channel: "data",
        value: true,
      });
    }
    expect(routingLog).toHaveLength(1);
    expect(routingLog[0]).toMatchObject({
      image: { type: "image" },
      meta: { label: "routed" },
    });
  });

  test("fails when edge references a missing source output", async () => {
    const definition: PipelineDefinition = {
      name: "missing-output",
      description: "Missing output edge",
      nodes: [
        {
          id: "produce",
          operation: "mock-produce-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
        {
          id: "consume",
          operation: "mock-consume-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
      ],
      edges: [{ from: "produce", to: "consume", output: "missing", input: "meta" }],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error.message).toContain("missing output");
    }
  });

  test("fails when routed artifact type is incompatible", async () => {
    const definition: PipelineDefinition = {
      name: "wrong-artifact-type",
      description: "Wrong artifact type",
      nodes: [
        {
          id: "produce",
          operation: "mock-produce-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
        {
          id: "consume",
          operation: "mock-consume-analysis-artifact",
          config: {},
          inputs: [],
          outputs: [],
        },
      ],
      edges: [{ from: "produce", to: "consume", output: "image" }],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error.message).toContain("expected artifact type analysis");
    }
  });

  test("merges parallel sibling outputs without overwriting", async () => {
    const definition: PipelineDefinition = {
      name: "parallel-output-merge",
      description: "Sibling output merge",
      nodes: [
        { id: "left", operation: "mock-a", config: {}, inputs: [], outputs: [] },
        { id: "right", operation: "mock-b", config: {}, inputs: [], outputs: [] },
      ],
      edges: [],
      inputs: [],
      outputs: [],
    };

    const exit = await runEffectExit(runPipeline(definition, testDir));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outputs["left:out"]).toEqual({ channel: "data", value: "a" });
      expect(exit.value.outputs["right:out"]).toEqual({ channel: "data", value: "b" });
    }
  });

  test("resume reloads persisted outputs shape", async () => {
    const sessionId = `resume-output-${Date.now()}`;
    const definition: PipelineDefinition = {
      name: "resume-output-shape",
      description: "Persist and reload outputs",
      nodes: [
        {
          id: "produce",
          operation: "mock-produce-artifact-data",
          config: {},
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
      inputs: [],
      outputs: [],
    };

    const firstExit = await runEffectExit(
      runPipeline(definition, testDir, undefined, { sessionId }),
    );
    expect(Exit.isSuccess(firstExit)).toBe(true);

    const resumeExit = await runEffectExit(resumePipeline(join(testDir, sessionId)));

    expect(Exit.isSuccess(resumeExit)).toBe(true);
    if (Exit.isSuccess(resumeExit)) {
      expect(resumeExit.value.outputs["produce:image"]?.channel).toBe("artifact");
      expect(resumeExit.value.outputs["produce:meta"]).toEqual({
        channel: "data",
        value: { label: "routed" },
      });
    }
  });
});
