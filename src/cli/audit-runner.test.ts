import { describe, expect, test } from 'bun:test';
import { getAuditFinalStatus, toErrorMessage } from './audit-runner.js';
import type { AuditManifest } from './scan-layout.js';

const baseManifest: AuditManifest = {
  type: 'vex-audit',
  auditId: 'audit-test',
  status: 'running',
  startedAt: '2026-04-24T00:00:00.000Z',
  outputDir: '/tmp/audit-test',
  provider: 'codex-cli',
  model: 'gpt-5.4',
  reasoning: 'low',
  urls: ['https://example.com'],
  devices: ['desktop-1920'],
  mode: 'analyze',
  full: false,
  placeholderMedia: false,
  fullPageScrollFix: false,
  totalRuns: 1,
  completedRuns: 0,
  failedRuns: 0,
  runs: [],
};

describe('toErrorMessage', () => {
  test('normalizes common thrown values', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage({ reason: 'bad' })).toBe('{"reason":"bad"}');
  });
});

describe('getAuditFinalStatus', () => {
  test('reports interrupted when signal handling requested stop', () => {
    expect(getAuditFinalStatus(baseManifest, true)).toBe('interrupted');
  });

  test('reports failed when every run failed', () => {
    expect(getAuditFinalStatus({ ...baseManifest, failedRuns: 1 }, false)).toBe('failed');
  });

  test('reports completed when at least one run completed or no runs exist', () => {
    expect(getAuditFinalStatus({ ...baseManifest, completedRuns: 1 }, false)).toBe('completed');
    expect(getAuditFinalStatus({ ...baseManifest, totalRuns: 0 }, false)).toBe('completed');
  });
});
