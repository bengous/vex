/**
 * DOM snapshot loader utilities.
 *
 * Loads DOM snapshots from session directories for use by locator strategies.
 */

import type { DOMSnapshot, ViewportConfig } from "./types.js";
import { Schema as S } from "effect";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOMSnapshot as DOMSnapshotSchema } from "./schema.js";
import { ARTIFACT_NAMES, getViewportDirName } from "./types.js";

export type LoadDOMSnapshotResult = {
  snapshot: DOMSnapshot | null;
  path: string | null;
  error?: string;
};

/**
 * Load DOM snapshot from session directory.
 * Auto-detects viewport directory if not specified.
 */
export async function loadDOMSnapshot(
  sessionDir: string,
  viewport?: ViewportConfig,
): Promise<LoadDOMSnapshotResult> {
  const directDomPath = join(sessionDir, ARTIFACT_NAMES.dom);

  if (existsSync(directDomPath)) {
    return loadDOMSnapshotFromPath(directDomPath);
  }

  let viewportDir: string;

  if (viewport !== undefined) {
    viewportDir = join(sessionDir, getViewportDirName(viewport));
  } else {
    const found = await findFirstViewportDir(sessionDir);
    if (found === null || found.length === 0) {
      return {
        snapshot: null,
        path: null,
        error: "No viewport directory found in session",
      };
    }
    viewportDir = found;
  }

  const domPath = join(viewportDir, ARTIFACT_NAMES.dom);
  return loadDOMSnapshotFromPath(domPath);
}

/**
 * Load DOM snapshot from explicit path.
 */
export async function loadDOMSnapshotFromPath(domPath: string): Promise<LoadDOMSnapshotResult> {
  if (!existsSync(domPath)) {
    return {
      snapshot: null,
      path: domPath,
      error: `DOM snapshot not found: ${domPath}`,
    };
  }

  try {
    const content = await readFile(domPath, "utf-8");
    const snapshot = normalizeDOMSnapshot(
      S.decodeUnknownSync(DOMSnapshotSchema)(JSON.parse(content)),
    );
    return { snapshot, path: domPath };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      snapshot: null,
      path: domPath,
      error: `Failed to parse DOM snapshot: ${message}`,
    };
  }
}

function normalizeDOMSnapshot(snapshot: typeof DOMSnapshotSchema.Type): DOMSnapshot {
  return {
    url: snapshot.url,
    timestamp: snapshot.timestamp,
    viewport: {
      width: snapshot.viewport.width,
      height: snapshot.viewport.height,
      deviceScaleFactor: snapshot.viewport.deviceScaleFactor,
      isMobile: snapshot.viewport.isMobile,
      ...(snapshot.viewport.hasTouch !== undefined ? { hasTouch: snapshot.viewport.hasTouch } : {}),
      ...(snapshot.viewport.userAgent !== undefined
        ? { userAgent: snapshot.viewport.userAgent }
        : {}),
    },
    html: snapshot.html,
    elements: snapshot.elements.map((element) => ({
      tagName: element.tagName,
      ...(element.id !== undefined ? { id: element.id } : {}),
      classes: element.classes,
      boundingBox: element.boundingBox,
      computedStyles: element.computedStyles,
      attributes: element.attributes,
      ...(element.xpath !== undefined ? { xpath: element.xpath } : {}),
    })),
  };
}

async function findFirstViewportDir(sessionDir: string): Promise<string | null> {
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name.startsWith("desktop-") || entry.name.startsWith("mobile-"))
      ) {
        return join(sessionDir, entry.name);
      }
    }
  } catch {}
  return null;
}
