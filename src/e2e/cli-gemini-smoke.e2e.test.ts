/**
 * E2E smoke test for CLI preset flow with Gemini CLI.
 *
 * Validates the exact user flow:
 * 1. Create vex.config.ts with scan preset
 * 2. Run `scan --preset <name>` through CLI
 * 3. Verify session/artifacts and provider metadata
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { ARTIFACT_NAMES, getViewportDirName, type ViewportConfig } from '../core/types.js';
import { getProviderInfo } from '../providers/shared/introspection.js';

import '../providers/init.js';

const PRESET_NAME = 'smokeExampleGeminiLite';
const VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

describe('CLI E2E - Gemini preset smoke', () => {
  let tempDir: string;
  let outputDir: string;

  beforeAll(async () => {
    if (!process.env.RUN_E2E) return;
    tempDir = mkdtempSync(join(tmpdir(), 'vex-cli-e2e-'));
    outputDir = join(tempDir, 'output');

    const configImportPath = resolve(import.meta.dir, '../config/index.js').replaceAll('\\', '/');
    const configText = `import { defineConfig } from '${configImportPath}';

export default defineConfig({
  outputDir: '${outputDir.replaceAll('\\', '/')}',
  scanPresets: {
    ${PRESET_NAME}: {
      urls: ['https://example.com/'],
      devices: 'desktop-1920',
      provider: { name: 'gemini-cli', model: 'gemini-2.5-flash-lite' },
      full: false,
    },
  },
});
`;

    writeFileSync(join(tempDir, 'vex.config.ts'), configText);
  });

  afterAll(async () => {
    if (!process.env.RUN_E2E) return;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!process.env.RUN_E2E)(
    'runs scan preset with gemini-cli and writes analysis artifact',
    async () => {
      const gemini = await Effect.runPromise(getProviderInfo('gemini-cli'));
      if (!gemini?.available) {
        console.log('SKIP: gemini-cli not available');
        return;
      }

      const cliEntry = resolve(import.meta.dir, '../cli/index.ts');
      const proc = Bun.spawn(['bun', cliEntry, 'scan', '--preset', PRESET_NAME], {
        cwd: tempDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain('Scanning https://example.com/');
      expect(stdout).toContain('Provider: gemini-cli (model: gemini-2.5-flash-lite)');
      expect(stdout).toContain('Audit:');

      const auditDirs = readdirSync(outputDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => name.startsWith('audit-'))
        .sort();
      expect(auditDirs.length).toBeGreaterThanOrEqual(1);

      const auditDir = join(outputDir, auditDirs[auditDirs.length - 1] ?? '');
      const statePath = join(auditDir, 'pages', 'example.com', '_index', getViewportDirName(VIEWPORT), 'state.json');
      const viewportDir = join(auditDir, 'pages', 'example.com', '_index', getViewportDirName(VIEWPORT));

      assert(existsSync(join(auditDir, 'audit.json')));
      assert(existsSync(join(auditDir, 'config.used.json')));
      assert(existsSync(join(auditDir, 'urls.txt')));
      assert(existsSync(statePath));
      assert(existsSync(join(viewportDir, ARTIFACT_NAMES.screenshot)));
      assert(existsSync(join(viewportDir, ARTIFACT_NAMES.withFolds)));
      assert(existsSync(join(viewportDir, ARTIFACT_NAMES.withGrid)));
      assert(existsSync(join(viewportDir, ARTIFACT_NAMES.analysis)));

      const state = await Bun.file(statePath).json();
      expect(state.status).toBe('completed');
      expect(state.issues).toBeArray();

      const audit = await Bun.file(join(auditDir, 'audit.json')).json();
      expect(audit.type).toBe('vex-audit');
      expect(audit.status).toBe('completed');
      expect(audit.completedRuns).toBe(1);

      const analysis = await Bun.file(join(viewportDir, ARTIFACT_NAMES.analysis)).json();
      expect(analysis.provider).toBe('gemini-cli');
      expect(analysis.model).toBe('gemini-2.5-flash-lite');
      expect(analysis.issues).toBeArray();
    },
    { timeout: 120_000 },
  );
});
