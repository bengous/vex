import type { FullPageScrollFixOptions, PlaceholderMediaOptions } from "./capture.js";
import type { ViewportConfig } from "./types.js";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  captureScreenshot,
  captureWithDOM,
  cropScreenshotToViewportWidth,
  getImageDimensionsFromBuffer,
} from "./capture.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
  );
});

const viewport: ViewportConfig = {
  width: 320,
  height: 568,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

const placeholderMedia: PlaceholderMediaOptions = {
  enabled: true,
  svgMinSize: 64,
  preserve: [".preserve-me"],
};

const fullPageScrollFix: FullPageScrollFixOptions = {
  enabled: true,
  selectors: ["main"],
  settleMs: 50,
  preserveHorizontalOverflow: false,
};

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "capture-test-"));
  tempDirs.push(dir);
  return dir;
}

async function createScreenshotBuffer(width = 658, height = 1200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer();
}

class FakeResponse {
  ok(): boolean {
    return true;
  }

  status(): number {
    return 200;
  }

  statusText(): string {
    return "OK";
  }
}

class FakePage {
  readonly steps: string[] = [];

  constructor(private readonly screenshotBuffer: Buffer) {}

  async goto(): Promise<FakeResponse> {
    return new FakeResponse();
  }

  async waitForLoadState(): Promise<void> {
    return;
  }

  async waitForTimeout(): Promise<void> {}

  async addStyleTag({ content }: { content: string }): Promise<void> {
    if (content.includes(".placeholder-media-box")) {
      this.steps.push("placeholder-css");
      return;
    }
    if (content.includes("flex: none")) {
      this.steps.push("full-page-scroll-fix");
      return;
    }
    if (content.includes("overflow-x: hidden")) {
      this.steps.push("overflow-clamp");
      return;
    }
    this.steps.push("cleanup-css");
  }

  async evaluate(_fn: unknown, arg: unknown): Promise<unknown> {
    if (arg === undefined) {
      this.steps.push("viewport-metrics");
      return {
        innerWidth: 320,
        innerHeight: 568,
        documentElementClientWidth: 320,
        documentElementClientHeight: 568,
        devicePixelRatio: 2,
        screen: { width: 320, height: 568, availWidth: 320, availHeight: 568 },
        visualViewport: {
          width: 320,
          height: 568,
          offsetTop: 0,
          offsetLeft: 0,
          pageTop: 0,
          pageLeft: 0,
          scale: 1,
        },
        viewportUnits: { svh: 568, lvh: 568, dvh: 568 },
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        userAgent: "fake",
        browserChromeCaptured: false,
        note: "fake",
      };
    }

    if (Array.isArray(arg)) {
      if (arg.includes("display")) {
        this.steps.push("dom-snapshot");
        return [
          {
            tagName: "main",
            id: "content",
            classes: ["page"],
            boundingBox: { x: 0, y: 0, width: 320, height: 568 },
            computedStyles: { display: "block" },
            attributes: { id: "content", class: "page" },
          },
        ];
      }

      this.steps.push("cleanup-overlays");
      return undefined;
    }

    this.steps.push("placeholder-media");
    return undefined;
  }

  async content(): Promise<string> {
    this.steps.push("dom-html");
    return '<html><body><main id="content" class="page"></main></body></html>';
  }

  async screenshot(): Promise<Buffer> {
    this.steps.push("screenshot");
    return this.screenshotBuffer;
  }
}

class FakeContext {
  constructor(readonly page: FakePage) {}

  async route(): Promise<void> {}

  async newPage(): Promise<FakePage> {
    return this.page;
  }

  async close(): Promise<void> {
    this.page.steps.push("context-close");
  }
}

class FakeBrowser {
  readonly context: FakeContext;
  contextOptions: unknown;

  constructor(page: FakePage) {
    this.context = new FakeContext(page);
  }

  async newContext(options: unknown): Promise<FakeContext> {
    this.contextOptions = options;
    return this.context;
  }
}

describe("getImageDimensionsFromBuffer", () => {
  test("uses actual image dimensions from screenshot buffer", async () => {
    const buffer = await sharp({
      create: {
        width: 768,
        height: 6706,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    const dimensions = await getImageDimensionsFromBuffer(buffer, { width: 320, height: 568 });
    expect(dimensions).toEqual({ width: 768, height: 6706 });
  });

  test("crops screenshot width to the emulated viewport when needed", async () => {
    const buffer = await sharp({
      create: {
        width: 658,
        height: 1200,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    const cropped = await cropScreenshotToViewportWidth(buffer, {
      width: 320,
      deviceScaleFactor: 2,
    });
    const dimensions = await getImageDimensionsFromBuffer(cropped, { width: 320, height: 568 });
    expect(dimensions).toEqual({ width: 640, height: 1200 });
  });
});

describe("capture wrappers", () => {
  test("captureWithDOM preserves mutation sequence before screenshot", async () => {
    const outputDir = createTempDir();
    const page = new FakePage(await createScreenshotBuffer());
    const browser = new FakeBrowser(page);

    const result = await captureWithDOM(
      browser as unknown as Parameters<typeof captureWithDOM>[0],
      {
        url: "https://example.test/",
        viewport: {
          ...viewport,
          screen: { width: 320, height: 568 },
          defaultBrowserType: "webkit",
        },
        outputDir,
        filename: "capture.png",
        placeholderMedia,
        fullPageScrollFix,
      },
    );

    expect(page.steps).toEqual([
      "cleanup-css",
      "cleanup-overlays",
      "full-page-scroll-fix",
      "viewport-metrics",
      "dom-snapshot",
      "dom-html",
      "placeholder-css",
      "placeholder-media",
      "overflow-clamp",
      "screenshot",
      "context-close",
    ]);
    expect(result.artifact.createdBy).toBe("capture-with-dom");
    expect(result.artifact.metadata.width).toBe(640);
    expect(result.artifact.metadata["browserChromeCaptured"]).toBe(false);
    expect(result.viewportMetrics.innerHeight).toBe(568);
    expect(browser.contextOptions).toMatchObject({
      screen: { width: 320, height: 568 },
    });
    expect(result.domSnapshot.elements).toHaveLength(1);
    expect(existsSync(join(outputDir, "capture.png"))).toBe(true);
    expect(existsSync(join(outputDir, "capture-viewport-metrics.json"))).toBe(true);
  });

  test("captureScreenshot uses the same screenshot path without DOM capture", async () => {
    const outputDir = createTempDir();
    const page = new FakePage(await createScreenshotBuffer(640, 900));
    const browser = new FakeBrowser(page);

    const result = await captureScreenshot(
      browser as unknown as Parameters<typeof captureScreenshot>[0],
      {
        url: "https://example.test/",
        viewport,
        outputDir,
        filename: "capture.png",
        placeholderMedia,
        fullPageScrollFix,
      },
    );

    expect(page.steps).toEqual([
      "cleanup-css",
      "cleanup-overlays",
      "full-page-scroll-fix",
      "viewport-metrics",
      "placeholder-css",
      "placeholder-media",
      "overflow-clamp",
      "screenshot",
      "context-close",
    ]);
    expect(result.artifact.createdBy).toBe("capture");
    expect(result.artifact.metadata.width).toBe(640);
    expect(result.artifact.metadata["viewportMetricsPath"]).toBe(
      join(outputDir, "capture-viewport-metrics.json"),
    );
    const metrics = JSON.parse(
      readFileSync(join(outputDir, "capture-viewport-metrics.json"), "utf8"),
    );
    expect(metrics.browserChromeCaptured).toBe(false);
    expect(existsSync(join(outputDir, "capture.png"))).toBe(true);
  });
});
