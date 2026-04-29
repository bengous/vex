/**
 * Screenshot capture for vex.
 *
 * Provides Playwright-based screenshot capture with optional DOM snapshots.
 * Handles overlay cleanup, network blocking, and placeholder media.
 */

import type {
  BoundingBox,
  DOMElement,
  DOMSnapshot,
  FoldConfig,
  ImageArtifact,
  ViewportConfig,
} from "./types.js";
import type { Browser, BrowserContext, Page, Route } from "playwright";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import sharp from "sharp";

// ═══════════════════════════════════════════════════════════════════════════
// Network Blocking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns for blocking overlay scripts at the network level.
 * Prevents cookie banners and chat widgets from loading.
 */
export const BLOCKED_SCRIPT_PATTERNS = [
  "booster_eu_cookie",
  "nova-cookie-app-embed",
  "consent-tracking-api",
  "inbox-chat-loader",
  "shopifyChatV1Widget",
  "crisp.chat",
  "intercom",
  "tidio",
];

/**
 * CSS selectors for overlay elements to hide/remove.
 */
export const OVERLAY_SELECTORS = {
  shopifyConsent: ["#shopify-pc__banner", ".shopify-pc__banner__dialog", '[role="alertdialog"]'],
  cookieBanners: [
    ".cc-window",
    ".cc-banner",
    '[aria-label="cookieconsent"]',
    '[role="dialog"][aria-label="cookieconsent"]',
    "#cookie-consent",
    ".cookie-banner",
    ".gdpr-banner",
    ".consent-banner",
  ],
  chatWidgets: [
    "#ShopifyChat",
    "inbox-online-store-chat",
    "shopify-chat",
    ".crisp-client",
    "#crisp-chatbox",
    ".intercom-messenger",
    "#intercom-container",
    ".tidio-chat",
    "#tidio-chat",
    'iframe[title*="chat" i]',
  ],
};

const OVERLAY_STABILIZATION_DELAY_MS = 300;

export type NetworkBlockingOptions = {
  readonly debug?: boolean;
};

/**
 * Sets up network-level blocking for overlay scripts.
 */
export async function setupNetworkBlocking(
  context: BrowserContext,
  options: NetworkBlockingOptions = {},
): Promise<void> {
  const { debug = false } = options;

  await context.route("**/*", async (route: Route) => {
    const url = route.request().url();
    const shouldBlock = BLOCKED_SCRIPT_PATTERNS.some((pattern) => url.includes(pattern));
    if (shouldBlock) {
      if (debug) {
        console.log("[networkBlocking] Blocked:", url);
      }
      return route.abort();
    }
    return route.continue();
  });
}

function getAllOverlaySelectors(): string[] {
  return [
    ...OVERLAY_SELECTORS.shopifyConsent,
    ...OVERLAY_SELECTORS.cookieBanners,
    ...OVERLAY_SELECTORS.chatWidgets,
  ];
}

/**
 * Injects CSS to hide overlay elements immediately.
 */
export async function injectOverlayHidingCSS(page: Page): Promise<void> {
  const selectors = getAllOverlaySelectors();
  const css = selectors
    .map((sel) => `${sel} { display: none !important; visibility: hidden !important; }`)
    .join("\n");
  await page.addStyleTag({ content: css });
}

/**
 * Removes overlay elements from the DOM.
 */
export async function removeOverlayElements(page: Page): Promise<void> {
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    }
  }, getAllOverlaySelectors());
}

/**
 * Comprehensive overlay cleanup.
 */
export async function cleanupOverlays(page: Page): Promise<void> {
  await injectOverlayHidingCSS(page);
  await removeOverlayElements(page);
  await page.waitForTimeout(OVERLAY_STABILIZATION_DELAY_MS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder Media
// ═══════════════════════════════════════════════════════════════════════════

const PLACEHOLDER_FILL_COLOR = "#E5E5E5";
const PLACEHOLDER_STROKE_COLOR = "#999999";

export type PlaceholderMediaOptions = {
  readonly enabled: boolean;
  readonly svgMinSize: number;
  readonly preserve: readonly string[];
};

/**
 * Full-page scroll fix for apps that scroll inside an internal container.
 */
export type FullPageScrollFixOptions = {
  readonly enabled: boolean;
  readonly selectors: readonly string[];
  readonly settleMs: number;
  readonly preserveHorizontalOverflow: boolean;
};

function getPlaceholderCSS(): string {
  return `
    .placeholder-media-box {
      background-color: ${PLACEHOLDER_FILL_COLOR} !important;
      background-image:
        linear-gradient(to bottom right,
          transparent calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% + 1px),
          transparent calc(50% + 1px)),
        linear-gradient(to bottom left,
          transparent calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% + 1px),
          transparent calc(50% + 1px)) !important;
      border: 1px solid ${PLACEHOLDER_STROKE_COLOR} !important;
      box-sizing: border-box !important;
    }
  `;
}

function getBackgroundImageOverrideCSS(): string {
  return `
    [style*="background-image"],
    [style*="background:"] {
      background-image:
        linear-gradient(to bottom right,
          transparent calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% + 1px),
          transparent calc(50% + 1px)),
        linear-gradient(to bottom left,
          transparent calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% - 1px),
          ${PLACEHOLDER_STROKE_COLOR} calc(50% + 1px),
          transparent calc(50% + 1px)) !important;
      background-color: ${PLACEHOLDER_FILL_COLOR} !important;
    }
  `;
}

/**
 * Applies placeholder media mode.
 */
export async function applyPlaceholderMedia(
  page: Page,
  options: PlaceholderMediaOptions,
): Promise<void> {
  if (!options.enabled) {
    return;
  }

  const css = getPlaceholderCSS() + getBackgroundImageOverrideCSS();
  await page.addStyleTag({ content: css });

  await page.evaluate(
    ({ minSize, preserveSelectors }) => {
      function createPlaceholder(width: number, height: number, display: string): HTMLDivElement {
        const div = document.createElement("div");
        div.className = "placeholder-media-box";
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        div.style.display = display === "inline" || display.length === 0 ? "inline-block" : display;
        return div;
      }

      function shouldPreserve(el: Element): boolean {
        for (const selector of preserveSelectors) {
          if (el.matches(selector) || el.closest(selector) !== null) {
            return true;
          }
        }
        return false;
      }

      document.querySelectorAll("img").forEach((img) => {
        if (shouldPreserve(img)) {
          return;
        }
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const display = window.getComputedStyle(img).display;
          img.replaceWith(createPlaceholder(rect.width, rect.height, display));
        }
      });

      document.querySelectorAll("video").forEach((video) => {
        if (shouldPreserve(video)) {
          return;
        }
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          video.replaceWith(createPlaceholder(rect.width, rect.height, "block"));
        }
      });

      document.querySelectorAll("picture").forEach((picture) => {
        if (shouldPreserve(picture)) {
          return;
        }
        const rect = picture.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          picture.replaceWith(createPlaceholder(rect.width, rect.height, "inline-block"));
        }
      });

      document.querySelectorAll("canvas").forEach((canvas) => {
        if (shouldPreserve(canvas)) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          canvas.replaceWith(createPlaceholder(rect.width, rect.height, "inline-block"));
        }
      });

      document.querySelectorAll("svg").forEach((svg) => {
        if (shouldPreserve(svg)) {
          return;
        }
        const rect = svg.getBoundingClientRect();
        if (rect.width >= minSize || rect.height >= minSize) {
          svg.replaceWith(createPlaceholder(rect.width, rect.height, "inline-block"));
        }
      });

      document.querySelectorAll("iframe").forEach((iframe) => {
        if (shouldPreserve(iframe)) {
          return;
        }
        const rect = iframe.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          iframe.replaceWith(createPlaceholder(rect.width, rect.height, "block"));
        }
      });
    },
    { minSize: options.svgMinSize, preserveSelectors: [...options.preserve] },
  );

  await page.waitForTimeout(100);
}

/**
 * Expand root + internal scroll container to make fullPage screenshots include
 * content that normally lives inside overflow:auto containers.
 */
async function applyFullPageScrollFix(
  page: Page,
  options: FullPageScrollFixOptions,
): Promise<void> {
  if (!options.enabled) {
    return;
  }

  const selectors = options.selectors.filter((selector) => selector.trim().length > 0);
  const containerSelectors = selectors.length > 0 ? selectors.join(", ") : "";
  const horizontalOverflow = options.preserveHorizontalOverflow ? "visible" : "hidden";

  const css = `
    html, body {
      height: auto !important;
      min-height: 100vh !important;
      overflow-y: visible !important;
      overflow-x: ${horizontalOverflow} !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    ${
      containerSelectors.length > 0
        ? `${containerSelectors} {
      height: auto !important;
      overflow-y: visible !important;
      overflow-x: ${horizontalOverflow} !important;
      flex: none !important;
      width: 100% !important;
      max-height: none !important;
      max-width: 100% !important;
    }`
        : ""
    }
  `;

  await page.addStyleTag({ content: css });
  await page.waitForTimeout(options.settleMs);
}

async function enforceHorizontalOverflowClamp(
  page: Page,
  selectors: readonly string[],
): Promise<void> {
  const filtered = selectors.filter((selector) => selector.trim().length > 0);
  const containerSelectors = filtered.length > 0 ? filtered.join(", ") : "";
  const css = `
    html, body {
      overflow-x: hidden !important;
      max-width: 100% !important;
    }
    ${
      containerSelectors.length > 0
        ? `${containerSelectors} {
      overflow-x: hidden !important;
      max-width: 100% !important;
    }`
        : ""
    }
  `;
  await page.addStyleTag({ content: css });
}

export async function getImageDimensionsFromBuffer(
  buffer: Buffer,
  fallback: Pick<ViewportConfig, "width" | "height">,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width ?? fallback.width,
    height: metadata.height ?? fallback.height,
  };
}

export async function cropScreenshotToViewportWidth(
  buffer: Buffer,
  viewport: Pick<ViewportConfig, "width" | "deviceScaleFactor">,
): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width === 0 ||
    metadata.height === 0
  ) {
    return buffer;
  }

  const expectedDeviceWidth = Math.max(1, Math.round(viewport.width * viewport.deviceScaleFactor));
  const expectedCssWidth = Math.max(1, Math.round(viewport.width));
  const targetWidth =
    Math.abs(metadata.width - expectedDeviceWidth) <= Math.abs(metadata.width - expectedCssWidth)
      ? expectedDeviceWidth
      : expectedCssWidth;

  if (metadata.width <= targetWidth) {
    return buffer;
  }

  return sharp(buffer)
    .extract({ left: 0, top: 0, width: targetWidth, height: metadata.height })
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════
// Screenshot Capture
// ═══════════════════════════════════════════════════════════════════════════

export type CaptureOptions = {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly outputDir: string;
  readonly filename: string;
  readonly fullPage?: boolean;
  readonly foldConfig?: FoldConfig;
  readonly placeholderMedia?: PlaceholderMediaOptions;
  readonly fullPageScrollFix?: FullPageScrollFixOptions;
  readonly navigationTimeout?: number;
  readonly loadStateTimeout?: number;
};

export type CaptureResult = {
  readonly artifact: ImageArtifact;
  readonly buffer: Buffer;
  readonly viewportMetrics: ViewportMetrics;
};

type InternalCaptureOptions = {
  readonly captureDOM: boolean;
  readonly captureStyles: readonly string[];
  readonly createdBy: string;
} & CaptureOptions;

type InternalCaptureResult = {
  readonly domSnapshot?: DOMSnapshot;
} & CaptureResult;

export type ViewportMetrics = {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly documentElementClientWidth: number;
  readonly documentElementClientHeight: number;
  readonly devicePixelRatio: number;
  readonly screen: {
    readonly width: number;
    readonly height: number;
    readonly availWidth: number;
    readonly availHeight: number;
  };
  readonly visualViewport?: {
    readonly width: number;
    readonly height: number;
    readonly offsetTop: number;
    readonly offsetLeft: number;
    readonly pageTop: number;
    readonly pageLeft: number;
    readonly scale: number;
  };
  readonly viewportUnits: {
    readonly svh: number;
    readonly lvh: number;
    readonly dvh: number;
  };
  readonly safeAreaInsets: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly userAgent: string;
  readonly note: string;
};

export async function collectViewportMetrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => {
    const readViewportUnit = (height: string): number => {
      const element = document.createElement("div");
      element.style.position = "fixed";
      element.style.visibility = "hidden";
      element.style.pointerEvents = "none";
      element.style.height = height;
      document.documentElement.append(element);
      const value = Number.parseFloat(getComputedStyle(element).height);
      element.remove();
      return Number.isFinite(value) ? value : 0;
    };

    const readSafeAreaInsets = (): {
      top: number;
      right: number;
      bottom: number;
      left: number;
    } => {
      const element = document.createElement("div");
      element.style.position = "fixed";
      element.style.visibility = "hidden";
      element.style.pointerEvents = "none";
      element.style.paddingTop = "env(safe-area-inset-top)";
      element.style.paddingRight = "env(safe-area-inset-right)";
      element.style.paddingBottom = "env(safe-area-inset-bottom)";
      element.style.paddingLeft = "env(safe-area-inset-left)";
      document.documentElement.append(element);
      const styles = getComputedStyle(element);
      const parse = (value: string): number => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const result = {
        top: parse(styles.paddingTop),
        right: parse(styles.paddingRight),
        bottom: parse(styles.paddingBottom),
        left: parse(styles.paddingLeft),
      };
      element.remove();
      return result;
    };

    const visual = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentElementClientWidth: document.documentElement.clientWidth,
      documentElementClientHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
      },
      ...(visual !== null
        ? {
            visualViewport: {
              width: visual.width,
              height: visual.height,
              offsetTop: visual.offsetTop,
              offsetLeft: visual.offsetLeft,
              pageTop: visual.pageTop,
              pageLeft: visual.pageLeft,
              scale: visual.scale,
            },
          }
        : {}),
      viewportUnits: {
        svh: readViewportUnit("100svh"),
        lvh: readViewportUnit("100lvh"),
        dvh: readViewportUnit("100dvh"),
      },
      safeAreaInsets: readSafeAreaInsets(),
      userAgent: navigator.userAgent,
      note: "Playwright page.screenshot captures the page viewport, not native browser or system chrome.",
    };
  });
}

async function captureDOMSnapshot(
  page: Page,
  url: string,
  viewport: ViewportConfig,
  captureStyles: readonly string[],
): Promise<DOMSnapshot> {
  const elements = await page.evaluate(
    (styleProps) => {
      const results: Array<{
        tagName: string;
        id?: string;
        classes: string[];
        boundingBox: { x: number; y: number; width: number; height: number };
        computedStyles: Record<string, string>;
        attributes: Record<string, string>;
      }> = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node: Node | null = walker.currentNode;

      while (node !== null) {
        if (node instanceof HTMLElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const computed = window.getComputedStyle(node);
            const styles: Record<string, string> = {};
            for (const prop of styleProps) {
              styles[prop] = computed.getPropertyValue(prop);
            }

            const attrs: Record<string, string> = {};
            for (let i = 0; i < node.attributes.length; i++) {
              const attr = node.attributes[i];
              if (attr !== undefined) {
                attrs[attr.name] = attr.value;
              }
            }

            results.push({
              tagName: node.tagName.toLowerCase(),
              ...(node.id.length > 0 ? { id: node.id } : {}),
              classes: Array.from(node.classList),
              boundingBox: {
                x: rect.x + window.scrollX,
                y: rect.y + window.scrollY,
                width: rect.width,
                height: rect.height,
              },
              computedStyles: styles,
              attributes: attrs,
            });
          }
        }
        node = walker.nextNode();
      }

      return results;
    },
    [...captureStyles],
  );

  const html = await page.content();
  const domElements: DOMElement[] = elements.map((el) =>
    Object.assign({ tagName: el.tagName }, el.id !== undefined ? { id: el.id } : {}, {
      classes: el.classes,
      boundingBox: el.boundingBox as BoundingBox,
      computedStyles: el.computedStyles,
      attributes: el.attributes,
    }),
  );

  return {
    url,
    timestamp: new Date().toISOString(),
    viewport,
    html,
    elements: domElements,
  };
}

async function runCapture(
  browser: Browser,
  options: InternalCaptureOptions,
): Promise<InternalCaptureResult> {
  const {
    url,
    viewport,
    outputDir,
    filename,
    fullPage = true,
    placeholderMedia,
    fullPageScrollFix,
    navigationTimeout = 30000,
    loadStateTimeout = 10000,
    captureDOM,
    captureStyles,
    createdBy,
  } = options;

  await mkdir(outputDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(viewport.screen !== undefined ? { screen: viewport.screen } : {}),
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    ...(viewport.hasTouch !== undefined ? { hasTouch: viewport.hasTouch } : {}),
    ...(viewport.userAgent !== undefined ? { userAgent: viewport.userAgent } : {}),
  });

  await setupNetworkBlocking(context);
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeout,
    });

    if (response === null || !response.ok()) {
      throw new Error(`HTTP ${response?.status()}: ${response?.statusText()}`);
    }

    await page.waitForLoadState("load", { timeout: loadStateTimeout }).catch(() => {
      // Ignore timeout, proceed with screenshot
    });

    await cleanupOverlays(page);
    if (fullPageScrollFix?.enabled === true) {
      await applyFullPageScrollFix(page, fullPageScrollFix);
    }

    const viewportMetrics = await collectViewportMetrics(page);

    const domSnapshot = captureDOM
      ? await captureDOMSnapshot(page, url, viewport, captureStyles)
      : undefined;

    if (placeholderMedia?.enabled === true) {
      await applyPlaceholderMedia(page, placeholderMedia);
    }

    if (fullPageScrollFix?.enabled === true && !fullPageScrollFix.preserveHorizontalOverflow) {
      await enforceHorizontalOverflowClamp(page, fullPageScrollFix.selectors);
    }

    let buffer = await page.screenshot({ fullPage });
    if (fullPageScrollFix?.enabled === true && !fullPageScrollFix.preserveHorizontalOverflow) {
      buffer = await cropScreenshotToViewportWidth(buffer, viewport);
    }
    const dimensions = await getImageDimensionsFromBuffer(buffer, viewport);
    const outputPath = join(outputDir, filename);
    const metricsPath = join(
      outputDir,
      `${basename(filename, extname(filename))}-viewport-metrics.json`,
    );
    await Promise.all([
      Bun.write(outputPath, buffer),
      Bun.write(metricsPath, JSON.stringify(viewportMetrics, null, 2)),
    ]);

    const artifact: ImageArtifact = {
      _kind: "artifact",
      id: crypto.randomUUID(),
      type: "image",
      path: outputPath,
      createdAt: new Date().toISOString(),
      createdBy,
      metadata: {
        width: dimensions.width,
        height: dimensions.height,
        url,
        viewport,
        hasGrid: false,
        hasFoldLines: false,
        hasAnnotations: false,
      },
    };

    return {
      artifact,
      buffer,
      viewportMetrics,
      ...(domSnapshot !== undefined ? { domSnapshot } : {}),
    };
  } finally {
    await context.close();
  }
}

/**
 * Captures a screenshot of a URL.
 */
export async function captureScreenshot(
  browser: Browser,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const result = await runCapture(browser, {
    ...options,
    captureDOM: false,
    captureStyles: [],
    createdBy: "capture",
  });
  return {
    artifact: result.artifact,
    buffer: result.buffer,
    viewportMetrics: result.viewportMetrics,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM Snapshot Capture
// ═══════════════════════════════════════════════════════════════════════════

export type DOMCaptureOptions = {
  readonly captureStyles?: readonly string[];
} & CaptureOptions;

export type DOMCaptureResult = {
  readonly domSnapshot: DOMSnapshot;
} & CaptureResult;

/**
 * Captures a screenshot with DOM snapshot for code location.
 */
export async function captureWithDOM(
  browser: Browser,
  options: DOMCaptureOptions,
): Promise<DOMCaptureResult> {
  const result = await runCapture(browser, {
    ...options,
    captureDOM: true,
    captureStyles: options.captureStyles ?? [
      "display",
      "position",
      "width",
      "height",
      "margin",
      "padding",
    ],
    createdBy: "capture-with-dom",
  });

  if (result.domSnapshot === undefined) {
    throw new Error("DOM snapshot was not captured");
  }

  return {
    artifact: result.artifact,
    buffer: result.buffer,
    viewportMetrics: result.viewportMetrics,
    domSnapshot: result.domSnapshot,
  };
}
