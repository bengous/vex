import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ARTIFACT_NAMES, type ArtifactName, type ViewportConfig } from '../../core/types.js';
import { createMockContext } from '../../testing/mocks/pipeline-context.js';
import { captureOperation } from './capture.js';

describe('captureOperation', () => {
  let server: ReturnType<typeof Bun.serve>;
  const tempDirs: string[] = [];

  const viewport: ViewportConfig = {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response('<!doctype html><html><body><main id="app">Capture operation</main></body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    });
  });

  afterAll(async () => {
    server.stop();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function createContext() {
    const testDir = mkdtempSync(join(tmpdir(), 'capture-operation-test-'));
    tempDirs.push(testDir);
    const ctx = createMockContext({ sessionDir: testDir });
    return {
      testDir,
      ctx: {
        ...ctx,
        getArtifactPath: (name: ArtifactName) => Effect.succeed(join(testDir, ARTIFACT_NAMES[name])),
      },
    };
  }

  test('stores only the image artifact when DOM capture is disabled', async () => {
    const { ctx, testDir } = createContext();

    const output = await Effect.runPromise(
      captureOperation.execute(undefined, { url: server.url.href, viewport, withDOM: false }, ctx),
    );

    expect(output.image.type).toBe('image');
    expect(output.image.path).toBe(join(testDir, ARTIFACT_NAMES.screenshot));
    expect(output.domSnapshot).toBeUndefined();
    expect(existsSync(output.image.path)).toBe(true);
    expect(existsSync(join(testDir, ARTIFACT_NAMES.dom))).toBe(false);
    expect(ctx.artifacts.size).toBe(1);
  });

  test('writes and stores DOM artifact only when requested', async () => {
    const { ctx, testDir } = createContext();

    const output = await Effect.runPromise(
      captureOperation.execute(undefined, { url: server.url.href, viewport, withDOM: true }, ctx),
    );

    expect(output.image.type).toBe('image');
    expect(output.domSnapshot?.type).toBe('dom-snapshot');
    expect(output.domSnapshot?.path).toBe(join(testDir, ARTIFACT_NAMES.dom));
    expect(existsSync(output.image.path)).toBe(true);
    expect(existsSync(join(testDir, ARTIFACT_NAMES.dom))).toBe(true);
    expect(ctx.artifacts.size).toBe(2);

    const dom = JSON.parse(readFileSync(join(testDir, ARTIFACT_NAMES.dom), 'utf8'));
    expect(dom.url).toBe(server.url.href);
    expect(dom.html).toContain('Capture operation');
    expect(output.domSnapshot?.metadata.elementCount).toBeGreaterThan(0);
  });
});
