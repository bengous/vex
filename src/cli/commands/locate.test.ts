import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Issue } from '../../core/types.js';
import { loadLocateSessionContext } from './locate.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vex-locate-command-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function createIssue(id: number): Issue {
  return {
    id,
    description: `Issue ${id}`,
    severity: 'medium',
    region: 'A1',
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadLocateSessionContext', () => {
  test('loads issues directly from pipeline state and keeps root session as DOM source', () => {
    const sessionDir = makeTempDir();
    writeJson(join(sessionDir, 'state.json'), { issues: [createIssue(1)] });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(1);
    expect(result.domSessionDir).toBe(sessionDir);
  });

  test('falls back to analysis artifact for pipeline session', () => {
    const sessionDir = makeTempDir();
    const analysisPath = join(sessionDir, 'analysis.json');
    writeJson(analysisPath, { issues: [createIssue(2)] });
    writeJson(join(sessionDir, 'state.json'), {
      artifacts: {
        analysis_1: {
          type: 'analysis',
          path: analysisPath,
        },
      },
    });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(2);
    expect(result.domSessionDir).toBe(sessionDir);
  });

  test('uses latest loop iteration issuesFound and pipeline sessionDir', () => {
    const sessionDir = makeTempDir();
    const latestPipelineSessionDir = join(sessionDir, '20260219-iteration');
    writeJson(join(sessionDir, 'state.json'), {
      type: 'vex-loop',
      iterationHistory: [
        {
          issuesFound: [createIssue(3)],
          pipelineState: {
            sessionDir: latestPipelineSessionDir,
          },
        },
      ],
    });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(3);
    expect(result.domSessionDir).toBe(latestPipelineSessionDir);
  });

  test('falls back to latest loop pipelineState issues when issuesFound is missing', () => {
    const sessionDir = makeTempDir();
    const latestPipelineSessionDir = join(sessionDir, '20260219-iteration');
    writeJson(join(sessionDir, 'state.json'), {
      type: 'vex-loop',
      iterationHistory: [
        {
          pipelineState: {
            sessionDir: latestPipelineSessionDir,
            issues: [createIssue(4)],
          },
        },
      ],
    });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(4);
    expect(result.domSessionDir).toBe(latestPipelineSessionDir);
  });

  test('falls back to latest loop pipeline analysis artifact issues', () => {
    const sessionDir = makeTempDir();
    const latestPipelineSessionDir = join(sessionDir, '20260219-iteration');
    const analysisPath = join(latestPipelineSessionDir, 'analysis.json');
    writeJson(analysisPath, { issues: [createIssue(5)] });
    writeJson(join(sessionDir, 'state.json'), {
      type: 'vex-loop',
      iterationHistory: [
        {
          pipelineState: {
            sessionDir: latestPipelineSessionDir,
            artifacts: {
              analysis_1: {
                type: 'analysis',
                path: analysisPath,
              },
            },
          },
        },
      ],
    });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(5);
    expect(result.domSessionDir).toBe(latestPipelineSessionDir);
  });

  test('falls back to root issues for loop state when latest iteration has no issues', () => {
    const sessionDir = makeTempDir();
    const latestPipelineSessionDir = join(sessionDir, '20260219-iteration');
    writeJson(join(sessionDir, 'state.json'), {
      type: 'vex-loop',
      iterationHistory: [
        {
          pipelineState: {
            sessionDir: latestPipelineSessionDir,
          },
        },
      ],
      issues: [createIssue(6)],
    });

    const result = loadLocateSessionContext(sessionDir);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.id).toBe(6);
    expect(result.domSessionDir).toBe(latestPipelineSessionDir);
  });
});
