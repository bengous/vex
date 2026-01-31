/**
 * DOM snapshot loader utilities.
 *
 * Loads DOM snapshots from session directories for use by locator strategies.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DOMSnapshot, ViewportConfig } from './types.js';
import { ARTIFACT_NAMES, getViewportDirName } from './types.js';

export interface LoadDOMSnapshotResult {
  snapshot: DOMSnapshot | null;
  path: string | null;
  error?: string;
}

/**
 * Load DOM snapshot from session directory.
 * Auto-detects viewport directory if not specified.
 */
export async function loadDOMSnapshot(sessionDir: string, viewport?: ViewportConfig): Promise<LoadDOMSnapshotResult> {
  let viewportDir: string;

  if (viewport) {
    viewportDir = join(sessionDir, getViewportDirName(viewport));
  } else {
    // Auto-detect first viewport directory
    const found = await findFirstViewportDir(sessionDir);
    if (!found) {
      return {
        snapshot: null,
        path: null,
        error: 'No viewport directory found in session',
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
    const content = await readFile(domPath, 'utf-8');
    const snapshot = JSON.parse(content) as DOMSnapshot;
    return { snapshot, path: domPath };
  } catch (e) {
    return {
      snapshot: null,
      path: domPath,
      error: `Failed to parse DOM snapshot: ${e}`,
    };
  }
}

async function findFirstViewportDir(sessionDir: string): Promise<string | null> {
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && (entry.name.startsWith('desktop-') || entry.name.startsWith('mobile-'))) {
        return join(sessionDir, entry.name);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return null;
}
