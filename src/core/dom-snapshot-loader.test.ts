import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDOMSnapshot } from './dom-snapshot-loader.js';
import type { DOMSnapshot } from './types.js';
import { ARTIFACT_NAMES } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vex-dom-loader-test-'));
  tempDirs.push(dir);
  return dir;
}

function createSnapshot(url: string): DOMSnapshot {
  return {
    url,
    timestamp: new Date().toISOString(),
    viewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      isMobile: false,
    },
    html: '<html></html>',
    elements: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadDOMSnapshot', () => {
  test('loads DOM snapshot directly from session dir when present', async () => {
    const dir = makeTempDir();
    const domPath = join(dir, ARTIFACT_NAMES.dom);
    writeFileSync(domPath, JSON.stringify(createSnapshot('https://example.com')), 'utf-8');

    const result = await loadDOMSnapshot(dir);
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(domPath);
    expect(result.snapshot?.url).toBe('https://example.com');
  });
});
