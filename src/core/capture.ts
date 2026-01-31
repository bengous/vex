/**
 * Screenshot capture for vex.
 *
 * Provides Playwright-based screenshot capture with optional DOM snapshots.
 * Handles overlay cleanup, network blocking, and placeholder media.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, chromium, Page, Route } from 'playwright';
import type { BoundingBox, DOMElement, DOMSnapshot, FoldConfig, ImageArtifact, ViewportConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Network Blocking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns for blocking overlay scripts at the network level.
 * Prevents cookie banners and chat widgets from loading.
 */
export const BLOCKED_SCRIPT_PATTERNS = [
  'booster_eu_cookie',
  'nova-cookie-app-embed',
  'consent-tracking-api',
  'inbox-chat-loader',
  'shopifyChatV1Widget',
  'crisp.chat',
  'intercom',
  'tidio',
];

/**
 * CSS selectors for overlay elements to hide/remove.
 */
export const OVERLAY_SELECTORS = {
  shopifyConsent: ['#shopify-pc__banner', '.shopify-pc__banner__dialog', '[role="alertdialog"]'],
  cookieBanners: [
    '.cc-window',
    '.cc-banner',
    '[aria-label="cookieconsent"]',
    '[role="dialog"][aria-label="cookieconsent"]',
    '#cookie-consent',
    '.cookie-banner',
    '.gdpr-banner',
    '.consent-banner',
  ],
  chatWidgets: [
    '#ShopifyChat',
    'inbox-online-store-chat',
    'shopify-chat',
    '.crisp-client',
    '#crisp-chatbox',
    '.intercom-messenger',
    '#intercom-container',
    '.tidio-chat',
    '#tidio-chat',
    'iframe[title*="chat" i]',
  ],
};

const OVERLAY_STABILIZATION_DELAY_MS = 300;

export interface NetworkBlockingOptions {
  readonly debug?: boolean;
}

/**
 * Sets up network-level blocking for overlay scripts.
 */
export async function setupNetworkBlocking(
  context: BrowserContext,
  options: NetworkBlockingOptions = {},
): Promise<void> {
  const { debug = false } = options;

  await context.route('**/*', (route: Route) => {
    const url = route.request().url();
    const shouldBlock = BLOCKED_SCRIPT_PATTERNS.some((pattern) => url.includes(pattern));
    if (shouldBlock) {
      if (debug) {
        console.log('[networkBlocking] Blocked:', url);
      }
      return route.abort();
    }
    return route.continue();
  });
}

function getAllOverlaySelectors(): string[] {
  return [...OVERLAY_SELECTORS.shopifyConsent, ...OVERLAY_SELECTORS.cookieBanners, ...OVERLAY_SELECTORS.chatWidgets];
}

/**
 * Injects CSS to hide overlay elements immediately.
 */
export async function injectOverlayHidingCSS(page: Page): Promise<void> {
  const selectors = getAllOverlaySelectors();
  const css = selectors.map((sel) => `${sel} { display: none !important; visibility: hidden !important; }`).join('\n');
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

const PLACEHOLDER_FILL_COLOR = '#E5E5E5';
const PLACEHOLDER_STROKE_COLOR = '#999999';

export interface PlaceholderMediaOptions {
  readonly enabled: boolean;
  readonly svgMinSize: number;
  readonly preserve: readonly string[];
}

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
export async function applyPlaceholderMedia(page: Page, options: PlaceholderMediaOptions): Promise<void> {
  if (!options.enabled) return;

  const css = getPlaceholderCSS() + getBackgroundImageOverrideCSS();
  await page.addStyleTag({ content: css });

  await page.evaluate(
    ({ minSize, preserveSelectors }) => {
      function createPlaceholder(width: number, height: number, display: string): HTMLDivElement {
        const div = document.createElement('div');
        div.className = 'placeholder-media-box';
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        div.style.display = display === 'inline' || !display ? 'inline-block' : display;
        return div;
      }

      function shouldPreserve(el: Element): boolean {
        for (const selector of preserveSelectors) {
          if (el.matches(selector) || el.closest(selector)) {
            return true;
          }
        }
        return false;
      }

      // Replace media elements
      document.querySelectorAll('img').forEach((img) => {
        if (shouldPreserve(img)) return;
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const display = window.getComputedStyle(img).display;
          img.replaceWith(createPlaceholder(rect.width, rect.height, display));
        }
      });

      document.querySelectorAll('video').forEach((video) => {
        if (shouldPreserve(video)) return;
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          video.replaceWith(createPlaceholder(rect.width, rect.height, 'block'));
        }
      });

      document.querySelectorAll('picture').forEach((picture) => {
        if (shouldPreserve(picture)) return;
        const rect = picture.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          picture.replaceWith(createPlaceholder(rect.width, rect.height, 'inline-block'));
        }
      });

      document.querySelectorAll('canvas').forEach((canvas) => {
        if (shouldPreserve(canvas)) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          canvas.replaceWith(createPlaceholder(rect.width, rect.height, 'inline-block'));
        }
      });

      document.querySelectorAll('svg').forEach((svg) => {
        if (shouldPreserve(svg)) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width >= minSize || rect.height >= minSize) {
          svg.replaceWith(createPlaceholder(rect.width, rect.height, 'inline-block'));
        }
      });

      document.querySelectorAll('iframe').forEach((iframe) => {
        if (shouldPreserve(iframe)) return;
        const rect = iframe.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          iframe.replaceWith(createPlaceholder(rect.width, rect.height, 'block'));
        }
      });
    },
    { minSize: options.svgMinSize, preserveSelectors: [...options.preserve] },
  );

  await page.waitForTimeout(100);
}

// ═══════════════════════════════════════════════════════════════════════════
// Screenshot Capture
// ═══════════════════════════════════════════════════════════════════════════

export interface CaptureOptions {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly outputDir: string;
  readonly filename: string;
  readonly fullPage?: boolean;
  readonly foldConfig?: FoldConfig;
  readonly placeholderMedia?: PlaceholderMediaOptions;
  readonly navigationTimeout?: number;
  readonly loadStateTimeout?: number;
}

export interface CaptureResult {
  readonly artifact: ImageArtifact;
  readonly buffer: Buffer;
}

/**
 * Captures a screenshot of a URL.
 */
export async function captureScreenshot(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const {
    url,
    viewport,
    outputDir,
    filename,
    fullPage = true,
    placeholderMedia,
    navigationTimeout = 30000,
    loadStateTimeout = 10000,
  } = options;

  await mkdir(outputDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    userAgent: viewport.userAgent,
  });

  await setupNetworkBlocking(context);
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeout,
    });

    if (!response?.ok()) {
      throw new Error(`HTTP ${response?.status()}: ${response?.statusText()}`);
    }

    await page.waitForLoadState('load', { timeout: loadStateTimeout }).catch(() => {
      // Ignore timeout, proceed with screenshot
    });

    await cleanupOverlays(page);

    if (placeholderMedia?.enabled) {
      await applyPlaceholderMedia(page, placeholderMedia);
    }

    const buffer = await page.screenshot({ fullPage });
    const outputPath = join(outputDir, filename);
    await Bun.write(outputPath, buffer);

    const artifact: ImageArtifact = {
      id: `img_${Date.now()}`,
      type: 'image',
      path: outputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'capture',
      metadata: {
        width: viewport.width,
        height: viewport.height,
        url,
        viewport,
        hasGrid: false,
        hasFoldLines: false,
        hasAnnotations: false,
      },
    };

    return { artifact, buffer };
  } finally {
    await context.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM Snapshot Capture
// ═══════════════════════════════════════════════════════════════════════════

export interface DOMCaptureOptions extends CaptureOptions {
  readonly captureStyles?: readonly string[];
}

export interface DOMCaptureResult extends CaptureResult {
  readonly domSnapshot: DOMSnapshot;
}

/**
 * Captures a screenshot with DOM snapshot for code location.
 */
export async function captureWithDOM(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  options: DOMCaptureOptions,
): Promise<DOMCaptureResult> {
  const {
    url,
    viewport,
    outputDir,
    filename,
    fullPage = true,
    placeholderMedia,
    navigationTimeout = 30000,
    loadStateTimeout = 10000,
    captureStyles = ['display', 'position', 'width', 'height', 'margin', 'padding'],
  } = options;

  console.log('[captureWithDOM] Starting capture for', url);
  console.log('[captureWithDOM] Output dir:', outputDir);

  await mkdir(outputDir, { recursive: true });
  console.log('[captureWithDOM] Directory created');

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    userAgent: viewport.userAgent,
  });
  console.log('[captureWithDOM] Context created');

  await setupNetworkBlocking(context, { debug: true });
  const page = await context.newPage();
  console.log('[captureWithDOM] Page created');

  try {
    console.log('[captureWithDOM] Navigating to URL...');
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeout,
    });
    console.log('[captureWithDOM] Navigation complete, status:', response?.status());

    if (!response?.ok()) {
      throw new Error(`HTTP ${response?.status()}: ${response?.statusText()}`);
    }

    console.log('[captureWithDOM] Waiting for load state...');
    await page.waitForLoadState('load', { timeout: loadStateTimeout }).catch(() => {
      console.log('[captureWithDOM] Load state timeout (ignored)');
    });
    console.log('[captureWithDOM] Load state complete');

    // Clean overlays BEFORE DOM capture for accurate code locator mapping
    await cleanupOverlays(page);
    console.log('[captureWithDOM] Overlays cleaned');

    // Capture DOM after cleanup - ensures DOM matches screenshot for locator accuracy
    console.log('[captureWithDOM] Starting DOM capture...');
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

        while (node) {
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
                if (attr) attrs[attr.name] = attr.value;
              }

              results.push({
                tagName: node.tagName.toLowerCase(),
                id: node.id || undefined,
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
    console.log('[captureWithDOM] DOM capture complete, elements:', elements.length);

    const html = await page.content();
    console.log('[captureWithDOM] HTML content captured, length:', html.length);

    if (placeholderMedia?.enabled) {
      await applyPlaceholderMedia(page, placeholderMedia);
      console.log('[captureWithDOM] Placeholder media applied');
    }

    console.log('[captureWithDOM] Taking screenshot...');
    const buffer = await page.screenshot({ fullPage });
    console.log('[captureWithDOM] Screenshot taken, size:', buffer.length);

    const outputPath = join(outputDir, filename);
    console.log('[captureWithDOM] Writing to:', outputPath);
    await Bun.write(outputPath, buffer);
    console.log('[captureWithDOM] File written successfully');

    const domElements: DOMElement[] = elements.map((el) => ({
      tagName: el.tagName,
      id: el.id,
      classes: el.classes,
      boundingBox: el.boundingBox as BoundingBox,
      computedStyles: el.computedStyles,
      attributes: el.attributes,
    }));

    const domSnapshot: DOMSnapshot = {
      url,
      timestamp: new Date().toISOString(),
      viewport,
      html,
      elements: domElements,
    };

    const artifact: ImageArtifact = {
      id: `img_${Date.now()}`,
      type: 'image',
      path: outputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'capture-with-dom',
      metadata: {
        width: viewport.width,
        height: viewport.height,
        url,
        viewport,
        hasGrid: false,
        hasFoldLines: false,
        hasAnnotations: false,
      },
    };

    return { artifact, buffer, domSnapshot };
  } finally {
    await context.close();
  }
}
