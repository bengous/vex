# vex Test Plan

E2E validation for the vex visual explorer tool.

## Prerequisites

```bash
cd /home/b3ngous/projects/shopify-mpzinc.wt/vision-annotation

# Verify Ollama is running (default provider)
curl http://localhost:11434/api/tags

# Verify Playwright browsers installed
bunx playwright install chromium
```

## Test Matrix

| Test | Command                  | Provider | Priority |
| ---- | ------------------------ | -------- | -------- |
| T1   | scan (desktop)           | ollama   | P0       |
| T2   | scan (mobile)            | ollama   | P0       |
| T3   | analyze (existing image) | ollama   | P0       |
| T4   | locate (session)         | -        | P1       |
| T5   | verify (session)         | -        | P1       |
| T6   | loop (1 iteration)       | ollama   | P2       |
| T7   | scan with claude-cli     | claude   | P2       |

---

## P0 Tests (Must Pass)

### T1: Scan Desktop

```bash
bun vex/cli/index.ts scan https://mpzinc.fr \
  --provider ollama \
  --output ./test-sessions
```

**Expected:**

- [ ] Session directory created in `./test-sessions/`
- [ ] Screenshot captured (`screenshot.png`)
- [ ] Fold lines visible in output
- [ ] Analysis JSON created with issues array
- [ ] No crashes/unhandled errors

**Validation:**

```bash
ls -la ./test-sessions/session-*/artifacts/
cat ./test-sessions/session-*/artifacts/analysis-*.json | jq '.issues | length'
```

---

### T2: Scan Mobile

```bash
bun vex/cli/index.ts scan https://mpzinc.fr \
  --mobile \
  --provider ollama \
  --output ./test-sessions
```

**Expected:**

- [ ] Screenshot dimensions ~375x812 (mobile)
- [ ] Fold lines at mobile intervals
- [ ] Analysis reflects mobile layout issues

**Validation:**

```bash
file ./test-sessions/session-*/artifacts/screenshot.png
# Should show dimensions around 375x...
```

---

### T3: Analyze Existing Image

First, get a screenshot from T1/T2, then:

```bash
bun vex/cli/index.ts analyze \
  ./test-sessions/session-XXXXX/artifacts/screenshot.png \
  --provider ollama
```

**Expected:**

- [ ] Reads existing image (no Playwright needed)
- [ ] Produces analysis with issues
- [ ] Output to stdout or new session

---

## P1 Tests (Should Pass)

### T4: Locate Code

Uses deterministic fixture with known issues and DOM snapshot:

```bash
# Use fixture session (no VLM needed, deterministic output)
bun vex/cli/index.ts locate ./vex/fixtures/locate-fixture
```

**Fixture contents:**

- 3 mock issues with regions matching DOM elements
- 10-element trimmed DOM snapshot (header, nav, main, footer, etc.)
- Real screenshot from mpzinc.fr

**Expected:**

- [ ] Reads session state with 3 issues
- [ ] DOM tracer finds elements at issue regions
- [ ] Outputs file:line candidates for each issue
- [ ] Confidence scores shown (high/medium/low)
- [ ] Output is identical on repeated runs (deterministic)

---

### T5: Verify Session

Requires a session with at least 2 iterations (or run loop first):

```bash
bun vex/cli/index.ts verify ./test-sessions/session-XXXXX
```

**Expected:**

- [ ] Compares baseline to current
- [ ] Shows resolved/introduced/unchanged issues
- [ ] Verdict: improved/regressed/unchanged/mixed

---

## P2 Tests (Nice to Have)

### T6: Loop (1 Iteration)

```bash
bun vex/cli/index.ts loop https://mpzinc.fr \
  --provider ollama \
  --max-iterations 1 \
  --output ./test-sessions
```

**Expected:**

- [ ] Completes capture→analyze→locate cycle
- [ ] Stops after 1 iteration
- [ ] Session state saved with iteration history

---

### T7: Scan with Claude CLI

```bash
bun vex/cli/index.ts scan https://mpzinc.fr \
  --provider claude-cli \
  --output ./test-sessions
```

**Expected:**

- [ ] Uses Claude CLI instead of Ollama
- [ ] Analysis quality comparable/better

---

## Error Scenarios

### E1: Invalid URL

```bash
bun vex/cli/index.ts scan not-a-url
```

**Expected:** Clear error message, non-zero exit

### E2: Provider Unavailable

```bash
bun vex/cli/index.ts scan https://mpzinc.fr --provider nonexistent
```

**Expected:** "Unknown provider" error with available providers listed

### E3: Missing Session

```bash
bun vex/cli/index.ts locate ./nonexistent-session
```

**Expected:** Clear "session not found" error

---

## Cleanup

```bash
rm -rf ./test-sessions
```

---

## Sign-off

| Test | Pass/Fail | Notes                                                                           | Date       |
| ---- | --------- | ------------------------------------------------------------------------------- | ---------- |
| T1   | PASS      | Scan desktop: session created, screenshot + DOM, analysis with 5 issues         | 2026-01-30 |
| T2   | PASS      | Scan mobile: 750px width (375x2 deviceScaleFactor)                              | 2026-01-30 |
| T3   | PASS      | Analyze existing image: works without Playwright                                | 2026-01-30 |
| T4   | PARTIAL   | Locate: loads issues from analysis artifact, DOM tracer needs both DOM + issues | 2026-01-30 |
| T5   | PASS      | Verify: correctly reports issue counts and verdict                              | 2026-01-30 |
| T6   | SKIP      | Loop: not tested (P2)                                                           | -          |
| T7   | SKIP      | Claude CLI: not tested (P2, requires API key)                                   | -          |
| E1   | PASS      | Invalid URL: clear error message, exit code 1                                   | 2026-01-30 |
| E2   | PASS      | Unknown provider: error with available providers listed                         | 2026-01-30 |
| E3   | PASS      | Missing session: clear error message, exit code 1                               | 2026-01-30 |

**Tested by:** Claude (automated E2E)
**Date:** 2026-01-30

### Fixes Applied

- `scan.ts`: Implemented using `runPipeline` + `simpleAnalysis` preset
- `analyze.ts`: Implemented using VisionProvider service directly
- `locate.ts`: Fixed to read issues from analysis artifact when state.issues empty
- `presets.ts`: Updated `simpleAnalysis` to include `withDOM: true`
- `runtime.ts`: Fixed artifact passing with semantic name mapping; populate state.issues after analyze
