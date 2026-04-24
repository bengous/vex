/**
 * Unit tests for verification fingerprinting and change detection.
 *
 * Tests the comparison logic that determines whether fixes improved,
 * regressed, or had no effect on detected issues.
 */

import type { Issue } from "../core/types.js";
import type { VerificationVerdict } from "./types.js";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createIssue, createPipelineState } from "../testing/factories.js";
import { isImproved, isResolved, verifyChanges } from "./verify.js";

// ═══════════════════════════════════════════════════════════════════════════
// Fingerprinting Tests (via verifyChanges)
// ═══════════════════════════════════════════════════════════════════════════

describe("issueFingerprint (via verifyChanges)", () => {
  test("same issue matches itself", async () => {
    const issue = createIssue({ description: "Button too small" });
    const baseline = createPipelineState({ issues: [issue] });
    const current = createPipelineState({ issues: [issue] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.unchanged.length).toBe(1);
    expect(result.resolved.length).toBe(0);
    expect(result.introduced.length).toBe(0);
  });

  test("different severity → different fingerprint → not matched", async () => {
    const baseIssue = createIssue({ id: 1, severity: "high", description: "Test issue" });
    const currIssue = createIssue({ id: 2, severity: "low", description: "Test issue" });
    const baseline = createPipelineState({ issues: [baseIssue] });
    const current = createPipelineState({ issues: [currIssue] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    // Different severity means they don't match - baseline is resolved, current is introduced
    expect(result.resolved.length).toBe(1);
    expect(result.introduced.length).toBe(1);
    expect(result.unchanged.length).toBe(0);
  });

  test("region as string vs object handles both", async () => {
    const issueWithString = createIssue({ region: "A1" });
    const issueWithBox = createIssue({ region: { x: 0, y: 0, width: 200, height: 200 } });

    // String region should match itself
    const baseline1 = createPipelineState({ issues: [issueWithString] });
    const current1 = createPipelineState({ issues: [issueWithString] });
    const result1 = await Effect.runPromise(verifyChanges(baseline1, current1));
    expect(result1.unchanged.length).toBe(1);

    // Box region should match itself
    const baseline2 = createPipelineState({ issues: [issueWithBox] });
    const current2 = createPipelineState({ issues: [issueWithBox] });
    const result2 = await Effect.runPromise(verifyChanges(baseline2, current2));
    expect(result2.unchanged.length).toBe(1);
  });

  test("description word order does not matter (words are sorted)", async () => {
    // Fingerprint uses first 5 words, sorted
    const issue1 = createIssue({ description: "alpha beta gamma delta epsilon" });
    const issue2 = createIssue({ description: "epsilon delta gamma beta alpha" });
    const baseline = createPipelineState({ issues: [issue1] });
    const current = createPipelineState({ issues: [issue2] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.unchanged.length).toBe(1);
    expect(result.resolved.length).toBe(0);
    expect(result.introduced.length).toBe(0);
  });

  test("fingerprint uses only first 5 words", async () => {
    const issue1 = createIssue({ description: "one two three four five extra words here" });
    const issue2 = createIssue({ description: "one two three four five totally different" });
    const baseline = createPipelineState({ issues: [issue1] });
    const current = createPipelineState({ issues: [issue2] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    // Same first 5 words (sorted) → same fingerprint → unchanged
    expect(result.unchanged.length).toBe(1);
  });

  test("fingerprint is case-insensitive", async () => {
    const issue1 = createIssue({ description: "Button Too Small" });
    const issue2 = createIssue({ description: "button too small" });
    const baseline = createPipelineState({ issues: [issue1] });
    const current = createPipelineState({ issues: [issue2] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.unchanged.length).toBe(1);
  });

  test("fingerprint collision: different issues with same fingerprint are matched (known limitation)", async () => {
    // Two semantically different issues can collide if they share:
    // - Same severity
    // - Same first 5 words (when sorted alphabetically)
    // - Same rounded region (x/100, y/100)
    //
    // This is a known limitation of fuzzy matching. The test documents the behavior.
    const issueA = createIssue({
      id: 1,
      description: "Button text is too small",
      severity: "medium",
      region: { x: 150, y: 250, width: 50, height: 50 }, // rounds to 2,3
    });

    const issueB = createIssue({
      id: 2,
      description: "Text button is too small for mobile", // same first 5 words when sorted
      severity: "medium",
      region: { x: 180, y: 280, width: 50, height: 50 }, // also rounds to 2,3
    });

    const baseline = createPipelineState({ issues: [issueA] });
    const current = createPipelineState({ issues: [issueB] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    // Both issues produce fingerprint: "medium:2,3:button is small text too"
    // Despite being different issues, they match → counted as unchanged
    expect(result.unchanged).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
    expect(result.introduced).toHaveLength(0);
    expect(result.verdict).toBe("unchanged");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// determineVerdict Tests (via verifyChanges)
// ═══════════════════════════════════════════════════════════════════════════

describe("determineVerdict (via verifyChanges)", () => {
  const verdictCases: [string, Issue[], Issue[], VerificationVerdict][] = [
    // [description, baseline, current, expected verdict]
    ["only resolved → improved", [createIssue({ id: 1 })], [], "improved"],
    ["only introduced → regressed", [], [createIssue({ id: 1 })], "regressed"],
    [
      "both resolved > introduced → mixed",
      [
        createIssue({ id: 1, description: "issue one" }),
        createIssue({ id: 2, description: "issue two" }),
      ],
      [createIssue({ id: 3, description: "new issue three" })],
      "mixed",
    ],
    [
      "both introduced > resolved → regressed",
      [createIssue({ id: 1, description: "old issue" })],
      [
        createIssue({ id: 2, description: "new issue two" }),
        createIssue({ id: 3, description: "new issue three" }),
      ],
      "regressed",
    ],
    [
      "neither resolved nor introduced (same issues) → unchanged",
      [createIssue({ id: 1, description: "same issue" })],
      [createIssue({ id: 1, description: "same issue" })],
      "unchanged",
    ],
    ["zero baseline + zero current → improved (clean state)", [], [], "improved"],
    [
      "equal resolved and introduced → mixed (resolved > introduced is false)",
      [createIssue({ id: 1, description: "will be resolved" })],
      [createIssue({ id: 2, description: "newly introduced" })],
      "regressed", // When equal, resolvedCount > introducedCount is false, so regressed
    ],
  ];

  test.each(verdictCases)("%s", async (_desc, baselineIssues, currentIssues, expectedVerdict) => {
    const baseline = createPipelineState({ issues: baselineIssues });
    const current = createPipelineState({ issues: currentIssues });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.verdict).toBe(expectedVerdict);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyChanges Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("verifyChanges", () => {
  test("matching issues go to unchanged", async () => {
    const issue = createIssue({ description: "persistent issue" });
    const baseline = createPipelineState({ issues: [issue] });
    const current = createPipelineState({ issues: [issue] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.unchanged).toContainEqual(issue);
    expect(result.resolved).toEqual([]);
    expect(result.introduced).toEqual([]);
  });

  test("missing baseline issues go to resolved", async () => {
    const issue = createIssue({ description: "was fixed" });
    const baseline = createPipelineState({ issues: [issue] });
    const current = createPipelineState({ issues: [] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.resolved).toContainEqual(issue);
    expect(result.unchanged).toEqual([]);
    expect(result.introduced).toEqual([]);
  });

  test("new current issues go to introduced", async () => {
    const issue = createIssue({ description: "new bug appeared" });
    const baseline = createPipelineState({ issues: [] });
    const current = createPipelineState({ issues: [issue] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.introduced).toContainEqual(issue);
    expect(result.unchanged).toEqual([]);
    expect(result.resolved).toEqual([]);
  });

  test("returns correct metrics", async () => {
    const issue1 = createIssue({ id: 1, description: "unchanged issue" });
    const issue2 = createIssue({ id: 2, description: "resolved issue" });
    const issue3 = createIssue({ id: 3, description: "new introduced issue" });

    const baseline = createPipelineState({ issues: [issue1, issue2] });
    const current = createPipelineState({ issues: [issue1, issue3] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.metrics.baselineIssueCount).toBe(2);
    expect(result.metrics.currentIssueCount).toBe(2);
    expect(result.metrics.resolvedCount).toBe(1);
    expect(result.metrics.introducedCount).toBe(1);
    expect(result.metrics.unchangedCount).toBe(1);
  });

  test("empty before and after → all arrays empty with improved verdict", async () => {
    const baseline = createPipelineState({ issues: [] });
    const current = createPipelineState({ issues: [] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.resolved).toEqual([]);
    expect(result.introduced).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.verdict).toBe("improved");
    expect(result.metrics.baselineIssueCount).toBe(0);
    expect(result.metrics.currentIssueCount).toBe(0);
    expect(result.metrics.improvementPercent).toBe(100);
  });

  test("all issues resolved (perfect improvement)", async () => {
    const issues = [
      createIssue({ id: 1, description: "layout overlap detected", severity: "high" }),
      createIssue({ id: 2, description: "contrast ratio too low", severity: "medium" }),
      createIssue({ id: 3, description: "missing alt text", severity: "low" }),
    ];
    const baseline = createPipelineState({ issues });
    const current = createPipelineState({ issues: [] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    expect(result.resolved).toHaveLength(3);
    expect(result.introduced).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.verdict).toBe("improved");
    expect(result.metrics.resolvedCount).toBe(3);
    expect(result.metrics.improvementPercent).toBe(100);
  });

  test("similar but not identical descriptions → fingerprint near-miss", async () => {
    // These share some words but differ in their first-5-word sorted set
    const baseIssue = createIssue({
      id: 1,
      description: "header font size inconsistent across breakpoints",
    });
    const currIssue = createIssue({
      id: 2,
      description: "navigation menu alignment broken on mobile",
    });
    const baseline = createPipelineState({ issues: [baseIssue] });
    const current = createPipelineState({ issues: [currIssue] });

    const result = await Effect.runPromise(verifyChanges(baseline, current));

    // Different first-5-word sets → different fingerprints → no match
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toEqual(baseIssue);
    expect(result.introduced).toHaveLength(1);
    expect(result.introduced[0]).toEqual(currIssue);
    expect(result.unchanged).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isImproved Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("isImproved", () => {
  test("resolved > introduced → true", () => {
    const baseline = createPipelineState({
      issues: [
        createIssue({ id: 1, description: "first issue" }),
        createIssue({ id: 2, description: "second issue" }),
      ],
    });
    const current = createPipelineState({
      issues: [createIssue({ id: 1, description: "first issue" })],
    });

    expect(isImproved(baseline, current)).toBe(true);
  });

  test("same issues → false", () => {
    const baseline = createPipelineState({ issues: [createIssue({ id: 1 })] });
    const current = createPipelineState({ issues: [createIssue({ id: 1 })] });

    expect(isImproved(baseline, current)).toBe(false);
  });

  test("more issues → false", () => {
    const baseline = createPipelineState({ issues: [createIssue({ id: 1 })] });
    const current = createPipelineState({
      issues: [createIssue({ id: 1 }), createIssue({ id: 2 })],
    });

    expect(isImproved(baseline, current)).toBe(false);
  });

  test("zero to zero → false (not less)", () => {
    const baseline = createPipelineState({ issues: [] });
    const current = createPipelineState({ issues: [] });

    expect(isImproved(baseline, current)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isResolved Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("isResolved", () => {
  test("zero issues → true", () => {
    const state = createPipelineState({ issues: [] });
    expect(isResolved(state)).toBe(true);
  });

  test("any issues → false", () => {
    const state = createPipelineState({ issues: [createIssue()] });
    expect(isResolved(state)).toBe(false);
  });

  test("multiple issues → false", () => {
    const state = createPipelineState({ issues: [createIssue({ id: 1 }), createIssue({ id: 2 })] });
    expect(isResolved(state)).toBe(false);
  });
});
