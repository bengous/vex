/**
 * Unit tests for gates decision matrix.
 *
 * Tests the human-in-the-loop decision logic that determines whether
 * an issue should be auto-fixed, sent for human review, or skipped.
 */

import type { CodeLocation, Issue } from "../core/types.js";
import type { GateAction, GateConfig, GateDecision } from "./types.js";
import { describe, expect, test } from "bun:test";
import { createCodeLocation, createIssue } from "../testing/factories.js";
import { evaluateGate, evaluateGates, filterByAction, summarizeDecisions } from "./gates.js";

// ═══════════════════════════════════════════════════════════════════════════
// evaluateGate Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("evaluateGate", () => {
  test("empty locations → skip", () => {
    const issue = createIssue();
    const result = evaluateGate(issue, []);

    expect(result.action).toBe("skip");
    expect(result.issue).toBe(issue);
    expect(result.reasoning).toContain("No code locations found");
  });

  test("high confidence + single file → auto-fix", () => {
    const issue = createIssue({ severity: "medium" });
    const locations = [createCodeLocation({ confidence: "high", file: "single.liquid" })];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("auto-fix");
    expect(result.location).toEqual(locations[0]);
    expect(result.reasoning).toContain("high confidence");
  });

  test("low confidence → human-review", () => {
    const issue = createIssue();
    const locations = [createCodeLocation({ confidence: "low" })];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("human-review");
    expect(result.reasoning).toContain("low confidence");
  });

  test("medium confidence + high severity → human-review", () => {
    const issue = createIssue({ severity: "high" });
    const locations = [createCodeLocation({ confidence: "medium" })];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("human-review");
    expect(result.reasoning).toContain("high severity");
  });

  test("medium confidence + low severity + single file → human-review (default autoFix threshold is high)", () => {
    const issue = createIssue({ severity: "low" });
    const locations = [createCodeLocation({ confidence: "medium", file: "single.liquid" })];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("human-review");
  });

  test("medium confidence + medium severity + single file → human-review (default autoFix threshold is high)", () => {
    const issue = createIssue({ severity: "medium" });
    const locations = [createCodeLocation({ confidence: "medium", file: "single.liquid" })];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("human-review");
  });

  test("multi-file → human-review (default config)", () => {
    const issue = createIssue();
    const locations = [
      createCodeLocation({ confidence: "high", file: "file1.liquid" }),
      createCodeLocation({ confidence: "high", file: "file2.liquid" }),
    ];

    const result = evaluateGate(issue, locations);

    expect(result.action).toBe("human-review");
    expect(result.reasoning).toContain("multi-file");
  });

  test("multi-file with allowMultiFileAutoFix=true → still human-review due to scope checks in auto-fix paths", () => {
    // Note: allowMultiFileAutoFix only bypasses the explicit multi-file gate,
    // but the auto-fix conditions (high conf single file, medium conf single file)
    // still require isSingleFile. This falls through to default human-review.
    const issue = createIssue();
    const locations = [
      createCodeLocation({ confidence: "high", file: "file1.liquid" }),
      createCodeLocation({ confidence: "high", file: "file2.liquid" }),
    ];
    const config: Partial<GateConfig> = { allowMultiFileAutoFix: true };

    const result = evaluateGate(issue, locations, config);

    // The implementation has auto-fix conditions with explicit isSingleFile checks,
    // so multi-file still falls to default human-review even with allowMultiFileAutoFix
    expect(result.action).toBe("human-review");
  });

  test("uses best (first) location for decision", () => {
    const issue = createIssue();
    // Locations should be pre-sorted by confidence (high first)
    const locations = [
      createCodeLocation({ confidence: "high", file: "best.liquid" }),
      createCodeLocation({ confidence: "low", file: "worst.liquid" }),
    ];

    const result = evaluateGate(issue, locations);

    expect(result.location?.file).toBe("best.liquid");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// evaluateGates Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("evaluateGates", () => {
  test("respects maxAutoFixesPerIteration limit", () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      createIssue({ id: i + 1, description: `Issue ${i + 1}` }),
    );
    const issuesWithLocations = issues.map((issue) => ({
      issue,
      locations: [createCodeLocation({ confidence: "high" })],
    }));
    const config: Partial<GateConfig> = { maxAutoFixesPerIteration: 3 };

    const results = evaluateGates(issuesWithLocations, config);

    const autoFixes = results.filter((d) => d.action === "auto-fix");
    const humanReviews = results.filter((d) => d.action === "human-review");

    expect(autoFixes.length).toBe(3);
    expect(humanReviews.length).toBe(2);
  });

  test("demotes to human-review after limit reached with reason", () => {
    const issues = Array.from({ length: 4 }, (_, i) =>
      createIssue({ id: i + 1, description: `Issue ${i + 1}` }),
    );
    const issuesWithLocations = issues.map((issue) => ({
      issue,
      locations: [createCodeLocation({ confidence: "high" })],
    }));
    const config: Partial<GateConfig> = { maxAutoFixesPerIteration: 2 };

    const results = evaluateGates(issuesWithLocations, config);
    expect(results).toHaveLength(4);

    // First 2 should be auto-fix
    expect(results[0]?.action).toBe("auto-fix");
    expect(results[1]?.action).toBe("auto-fix");

    // 3rd and 4th should be demoted to human-review with limit reason
    expect(results[2]?.action).toBe("human-review");
    expect(results[2]?.reasoning).toContain("auto-fix limit reached");
    expect(results[3]?.action).toBe("human-review");
    expect(results[3]?.reasoning).toContain("auto-fix limit reached");
  });

  test("handles empty input", () => {
    const results = evaluateGates([]);
    expect(results).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// filterByAction Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("filterByAction", () => {
  const decisions: GateDecision[] = [
    { action: "auto-fix", issue: createIssue({ id: 1 }), reasoning: "r1" },
    { action: "human-review", issue: createIssue({ id: 2 }), reasoning: "r2" },
    { action: "skip", issue: createIssue({ id: 3 }), reasoning: "r3" },
    { action: "auto-fix", issue: createIssue({ id: 4 }), reasoning: "r4" },
    { action: "abort", issue: createIssue({ id: 5 }), reasoning: "r5" },
  ];

  test("filters auto-fix correctly", () => {
    const filtered = filterByAction(decisions, "auto-fix");
    expect(filtered.length).toBe(2);
    expect(filtered.map((d) => d.issue.id)).toEqual([1, 4]);
  });

  test("filters human-review correctly", () => {
    const filtered = filterByAction(decisions, "human-review");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.issue.id).toBe(2);
  });

  test("filters skip correctly", () => {
    const filtered = filterByAction(decisions, "skip");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.issue.id).toBe(3);
  });

  test("filters abort correctly", () => {
    const filtered = filterByAction(decisions, "abort");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.issue.id).toBe(5);
  });

  test("empty array returns empty", () => {
    const filtered = filterByAction([], "auto-fix");
    expect(filtered).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// summarizeDecisions Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("summarizeDecisions", () => {
  test("counts all action types correctly", () => {
    const decisions: GateDecision[] = [
      { action: "auto-fix", issue: createIssue({ id: 1 }), reasoning: "r1" },
      { action: "auto-fix", issue: createIssue({ id: 2 }), reasoning: "r2" },
      { action: "human-review", issue: createIssue({ id: 3 }), reasoning: "r3" },
      { action: "skip", issue: createIssue({ id: 4 }), reasoning: "r4" },
      { action: "abort", issue: createIssue({ id: 5 }), reasoning: "r5" },
      { action: "skip", issue: createIssue({ id: 6 }), reasoning: "r6" },
    ];

    const summary = summarizeDecisions(decisions);

    expect(summary).toEqual({
      "auto-fix": 2,
      "human-review": 1,
      skip: 2,
      abort: 1,
    });
  });

  test("empty array returns all zeros", () => {
    const summary = summarizeDecisions([]);

    expect(summary).toEqual({
      "auto-fix": 0,
      "human-review": 0,
      skip: 0,
      abort: 0,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Decision Matrix Integration Tests (parameterized)
// ═══════════════════════════════════════════════════════════════════════════

describe("Decision Matrix", () => {
  // [confidence, severity, isSingleFile, allowMultiFix, expected]
  // Note: The implementation has auto-fix paths with explicit isSingleFile checks,
  // so allowMultiFileAutoFix only bypasses the multi-file gate, not the auto-fix conditions
  type MatrixCase = [CodeLocation["confidence"], Issue["severity"], boolean, boolean, GateAction];

  const matrixCases: MatrixCase[] = [
    // High confidence
    ["high", "low", true, false, "auto-fix"],
    ["high", "medium", true, false, "auto-fix"],
    ["high", "high", true, false, "auto-fix"],
    ["high", "high", false, false, "human-review"], // multi-file
    ["high", "high", false, true, "human-review"], // multi-file allowed but auto-fix paths require single file

    // Medium confidence
    ["medium", "low", true, false, "human-review"], // changed from auto-fix because default threshold is high
    ["medium", "medium", true, false, "human-review"], // changed from auto-fix because default threshold is high
    ["medium", "high", true, false, "human-review"], // high severity blocks
    ["medium", "high", false, false, "human-review"],

    // Low confidence - always review
    ["low", "low", true, false, "human-review"],
    ["low", "medium", true, false, "human-review"],
    ["low", "high", true, false, "human-review"],
    ["low", "low", false, true, "human-review"], // even with multi-file allowed
  ];

  test.each(matrixCases)(
    "conf=%s, sev=%s, single=%s, allowMulti=%s → %s",
    (confidence, severity, isSingleFile, allowMultiFix, expected) => {
      const issue = createIssue({ severity });
      const locations = isSingleFile
        ? [createCodeLocation({ confidence, file: "single.liquid" })]
        : [
            createCodeLocation({ confidence, file: "file1.liquid" }),
            createCodeLocation({ confidence, file: "file2.liquid" }),
          ];
      const config: Partial<GateConfig> = { allowMultiFileAutoFix: allowMultiFix };

      const result = evaluateGate(issue, locations, config);

      expect(result.action).toBe(expected);
    },
  );
});
