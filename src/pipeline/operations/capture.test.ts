import type { ArtifactName, ViewportConfig } from "../../core/types.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_NAMES } from "../../core/types.js";
import { createMockContext } from "../../testing/mocks/pipeline-context.js";
import { captureOperation } from "./capture.js";

describe("captureOperation", () => {
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
        new Response(
          '<!doctype html><html><body><main id="app">Capture operation</main></body></html>',
          {
            headers: { "content-type": "text/html" },
          },
        ),
    });
  });

  afterAll(async () => {
    await server.stop();
    await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
  });

  function createContext() {
    const testDir = mkdtempSync(join(tmpdir(), "capture-operation-test-"));
    tempDirs.push(testDir);
    const ctx = createMockContext({ sessionDir: testDir });
    return {
      testDir,
      ctx: {
        ...ctx,
        getArtifactPath: (name: ArtifactName) =>
          Effect.succeed(join(testDir, ARTIFACT_NAMES[name])),
      },
    };
  }

  test("stores only the image artifact when DOM capture is disabled", async () => {
    const { ctx, testDir } = createContext();

    const output = await Effect.runPromise(
      captureOperation.execute(undefined, { url: server.url.href, viewport, withDOM: false }, ctx),
    );

    expect(output.artifacts.image.type).toBe("image");
    expect(output.artifacts.image.path).toBe(join(testDir, ARTIFACT_NAMES.screenshot));
    expect(output.artifacts.domSnapshot).toBeUndefined();
    expect(existsSync(output.artifacts.image.path)).toBe(true);
    expect(existsSync(join(testDir, ARTIFACT_NAMES.dom))).toBe(false);
    expect(ctx.artifacts.size).toBe(0);
  });

  test("writes and stores DOM artifact only when requested", async () => {
    const { ctx, testDir } = createContext();

    const output = await Effect.runPromise(
      captureOperation.execute(undefined, { url: server.url.href, viewport, withDOM: true }, ctx),
    );

    expect(output.artifacts.image.type).toBe("image");
    expect(output.artifacts.domSnapshot?.type).toBe("dom-snapshot");
    expect(output.artifacts.domSnapshot?.path).toBe(join(testDir, ARTIFACT_NAMES.dom));
    expect(existsSync(output.artifacts.image.path)).toBe(true);
    expect(existsSync(join(testDir, ARTIFACT_NAMES.dom))).toBe(true);
    expect(ctx.artifacts.size).toBe(0);

    const dom = JSON.parse(readFileSync(join(testDir, ARTIFACT_NAMES.dom), "utf8"));
    expect(dom.url).toBe(server.url.href);
    expect(dom.html).toContain("Capture operation");
    expect(output.artifacts.domSnapshot?.metadata.elementCount).toBeGreaterThan(0);
  });
});
