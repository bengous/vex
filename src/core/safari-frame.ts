import type { ImageArtifact, SafariFrameOptions, ViewportConfig } from "./types.js";
import sharp from "sharp";

export type SafariFrameRenderResult = {
  readonly buffer: Buffer;
  readonly metadata: {
    readonly width: number;
    readonly height: number;
    readonly topChromeCss: number;
    readonly bottomChromeCss: number;
    readonly foldY: number;
    readonly scale: number;
  };
};

const IPHONE_PRO_MAX_TOP_CHROME_CSS = 111;

function getTopChromeCss(viewport: ViewportConfig): number {
  const chromeCss =
    viewport.screen !== undefined ? viewport.screen.height - viewport.height : undefined;
  if (chromeCss === undefined || chromeCss <= 0) {
    return 0;
  }

  if (viewport.screen?.width === 430 && viewport.screen.height === 932) {
    return Math.min(IPHONE_PRO_MAX_TOP_CHROME_CSS, chromeCss);
  }

  return Math.round(chromeCss * 0.58);
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safariChromeSvg(params: {
  readonly width: number;
  readonly height: number;
  readonly topChromePx: number;
  readonly bottomChromePx: number;
  readonly foldY: number;
  readonly urlLabel: string;
}): string {
  const { bottomChromePx, foldY, height, topChromePx, urlLabel, width } = params;
  const statusHeight = Math.round(topChromePx * 0.42);
  const addressBarY = Math.max(8, statusHeight + Math.round(topChromePx * 0.08));
  const addressBarHeight = Math.max(34, topChromePx - addressBarY - 12);
  const addressBarX = Math.round(width * 0.025);
  const addressBarWidth = width - addressBarX * 2;
  const bottomY = height - bottomChromePx;
  const iconY = bottomY + Math.round(bottomChromePx * 0.55);
  const label = escapeXml(urlLabel);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${topChromePx}" fill="#303336"/>
    <text x="${Math.round(width * 0.13)}" y="${Math.round(statusHeight * 0.62)}" fill="#f6f6f6" font-family="Arial, sans-serif" font-size="${Math.max(24, Math.round(statusHeight * 0.36))}" font-weight="700">12:40</text>
    <rect x="${addressBarX}" y="${addressBarY}" width="${addressBarWidth}" height="${addressBarHeight}" rx="${Math.round(addressBarHeight / 2)}" fill="#686d72"/>
    <text x="${Math.round(width / 2)}" y="${addressBarY + Math.round(addressBarHeight * 0.65)}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="${Math.max(24, Math.round(addressBarHeight * 0.38))}">${label}</text>
    <rect x="0" y="${bottomY}" width="${width}" height="${bottomChromePx}" fill="#303336"/>
    <text x="${Math.round(width * 0.07)}" y="${iconY}" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="${Math.max(32, Math.round(bottomChromePx * 0.34))}">&lt;</text>
    <text x="${Math.round(width * 0.28)}" y="${iconY}" fill="#909498" font-family="Arial, sans-serif" font-size="${Math.max(32, Math.round(bottomChromePx * 0.34))}">&gt;</text>
    <text x="${Math.round(width * 0.5)}" y="${iconY}" text-anchor="middle" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="${Math.max(34, Math.round(bottomChromePx * 0.38))}">+</text>
    <text x="${Math.round(width * 0.72)}" y="${iconY}" text-anchor="middle" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="${Math.max(28, Math.round(bottomChromePx * 0.28))}">[]</text>
    <text x="${Math.round(width * 0.91)}" y="${iconY}" text-anchor="middle" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="${Math.max(30, Math.round(bottomChromePx * 0.32))}">...</text>
    <line x1="0" y1="${foldY}" x2="${width}" y2="${foldY}" stroke="#FF0000" stroke-width="2" stroke-dasharray="10,5" stroke-opacity="0.9"/>
  </svg>`;
}

export async function renderSafariFrame(
  image: ImageArtifact,
  options: SafariFrameOptions,
): Promise<SafariFrameRenderResult> {
  if (options.name !== "safari-ios" || options.style !== "singleshot") {
    throw new Error(`Unsupported Safari frame mode: ${options.name}/${options.style}`);
  }

  const viewport = image.metadata.viewport;
  if (viewport?.screen === undefined) {
    throw new Error("Safari frame rendering requires viewport screen metadata");
  }

  const input = sharp(image.path);
  const imageMetadata = await input.metadata();
  if (imageMetadata.width === undefined || imageMetadata.height === undefined) {
    throw new Error("Failed to read input image dimensions");
  }

  const scale = imageMetadata.width / viewport.width;
  const contentHeightPx = Math.round(viewport.height * scale);
  const width = Math.round(viewport.screen.width * scale);
  const height = Math.round(viewport.screen.height * scale);
  const topChromeCss = getTopChromeCss(viewport);
  const bottomChromeCss = viewport.screen.height - viewport.height - topChromeCss;
  if (bottomChromeCss < 0) {
    throw new Error("Safari frame chrome dimensions exceed screen height");
  }

  const topChromePx = Math.round(topChromeCss * scale);
  const bottomChromePx = Math.round(bottomChromeCss * scale);
  const foldY = topChromePx + contentHeightPx;
  const content = await input
    .extract({
      left: 0,
      top: 0,
      width: imageMetadata.width,
      height: Math.min(contentHeightPx, imageMetadata.height),
    })
    .resize({ width, height: contentHeightPx, fit: "fill" })
    .toBuffer();

  const host = image.metadata.url !== undefined ? new URL(image.metadata.url).hostname : "page";
  const chrome = Buffer.from(
    safariChromeSvg({
      width,
      height,
      topChromePx,
      bottomChromePx,
      foldY,
      urlLabel: host,
    }),
  );

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#303336",
    },
  })
    .composite([
      { input: content, left: 0, top: topChromePx },
      { input: chrome, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    metadata: {
      width,
      height,
      topChromeCss,
      bottomChromeCss,
      foldY,
      scale,
    },
  };
}
