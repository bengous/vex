/**
 * Helpers for organizing scan output into audit/page/viewport directories.
 */

import type { ViewportConfig } from "../core/types.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getViewportDirName } from "../core/types.js";

export type AuditStatus = "running" | "completed" | "failed" | "interrupted";
export type AuditRunStatus = "running" | "completed" | "failed";

export type AuditRunRecord = {
  url: string;
  deviceId: string;
  viewport?: ViewportConfig;
  pagePath: string;
  viewportPath: string;
  startedAt: string;
  completedAt?: string;
  status: AuditRunStatus;
  issueCount?: number;
  error?: string;
};

export type AuditManifest = {
  type: "vex-audit";
  auditId: string;
  status: AuditStatus;
  startedAt: string;
  completedAt?: string;
  outputDir: string;
  provider: string;
  model?: string;
  reasoning?: string;
  preset?: string;
  urls: readonly string[];
  devices: readonly string[];
  mode?: "analyze" | "capture-only";
  full: boolean;
  placeholderMedia: boolean;
  fullPageScrollFix: boolean;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runs: AuditRunRecord[];
};

function sanitizePathSegment(segment: string): string {
  const reservedNormalized = segment
    .trim()
    .replaceAll(/%2f/gi, "_")
    .replaceAll(/[<>:"/\\|?*]/g, "_");

  const normalized = Array.from(reservedNormalized, (char) =>
    char.charCodeAt(0) < 32 ? "_" : char,
  ).join("");

  return normalized.length > 0 ? normalized : "_";
}

function buildVariantSuffix(url: URL): string | undefined {
  if (url.search.length === 0 && url.hash.length === 0) {
    return undefined;
  }
  const hash = createHash("sha1").update(`${url.search}${url.hash}`).digest("hex").slice(0, 8);
  return `variant-${hash}`;
}

/**
 * Create audit identifier in format: audit-YYYYMMDD-HHMM
 */
export function buildAuditId(date: Date = new Date()): string {
  const iso = date.toISOString();
  const datePart = iso.slice(0, 10).replaceAll("-", "");
  const timePart = iso.slice(11, 16).replace(":", "");
  return `audit-${datePart}-${timePart}`;
}

/**
 * Map URL to page path segments under audit/pages.
 *
 * Every terminal route maps to "_index" so route folders can contain both
 * nested child routes and artifacts for the route itself without collisions.
 */
export function urlToPagePathSegments(rawUrl: string): readonly string[] {
  const url = new URL(rawUrl);
  const host = sanitizePathSegment(url.hostname.toLowerCase());
  const pathSegments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(sanitizePathSegment);

  const variant = buildVariantSuffix(url);
  const leaf = variant !== undefined ? `_index__${variant}` : "_index";
  return [host, ...pathSegments, leaf];
}

/**
 * Absolute page directory path for a URL under an audit directory.
 */
export function getAuditPageDir(auditDir: string, rawUrl: string): string {
  return join(auditDir, "pages", ...urlToPagePathSegments(rawUrl));
}

/**
 * Absolute viewport directory path for URL+viewport under an audit directory.
 */
export function getAuditViewportDir(
  auditDir: string,
  rawUrl: string,
  viewport: ViewportConfig,
  deviceId?: string,
): string {
  return join(getAuditPageDir(auditDir, rawUrl), getViewportDirName(viewport, deviceId));
}
