import { describe, expect, test } from 'bun:test';
import type { ViewportConfig } from '../core/types.js';
import { buildAuditId, getAuditPageDir, getAuditViewportDir, urlToPagePathSegments } from './scan-layout.js';

const VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

describe('buildAuditId', () => {
  test('formats timestamp with date and minute precision', () => {
    const id = buildAuditId(new Date('2026-02-20T17:30:12.000Z'));
    expect(id).toBe('audit-20260220-1730');
  });
});

describe('urlToPagePathSegments', () => {
  test('maps root route to host + _index', () => {
    expect(urlToPagePathSegments('https://bengous.github.io/')).toEqual(['bengous.github.io', '_index']);
  });

  test('maps nested route to host + segments + _index', () => {
    expect(urlToPagePathSegments('https://bengous.github.io/IdeAs/fr/about')).toEqual([
      'bengous.github.io',
      'IdeAs',
      'fr',
      'about',
      '_index',
    ]);
  });

  test('keeps trailing-slash variants stable', () => {
    expect(urlToPagePathSegments('https://bengous.github.io/IdeAs/fr/')).toEqual([
      'bengous.github.io',
      'IdeAs',
      'fr',
      '_index',
    ]);
  });

  test('adds deterministic variant suffix for query/hash URLs', () => {
    const base = urlToPagePathSegments('https://example.com/fr');
    const variant = urlToPagePathSegments('https://example.com/fr?mode=preview#top');
    expect(base).toEqual(['example.com', 'fr', '_index']);
    expect(variant[0]).toBe('example.com');
    expect(variant[1]).toBe('fr');
    expect(variant[2]).toStartWith('_index__variant-');
    expect(variant[2]?.length).toBe('_index__variant-'.length + 8);
  });
});

describe('audit path helpers', () => {
  test('builds page and viewport directories', () => {
    const pageDir = getAuditPageDir('/tmp/audit-20260220-1730', 'https://example.com/fr/about');
    const viewportDir = getAuditViewportDir('/tmp/audit-20260220-1730', 'https://example.com/fr/about', VIEWPORT);

    expect(pageDir).toBe('/tmp/audit-20260220-1730/pages/example.com/fr/about/_index');
    expect(viewportDir).toBe('/tmp/audit-20260220-1730/pages/example.com/fr/about/_index/desktop-1920x1080');
  });
});

