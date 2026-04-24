/**
 * User-facing config API.
 *
 * Internal code imports directly from schema.js and loader.js.
 *
 * @example
 * ```typescript
 * import { defineConfig } from './vex/config/index.js';
 *
 * export default defineConfig({
 *   outputDir: 'vex-output',
 *   scanPresets: {
 *     quick: { devices: 'desktop-1920' },
 *   },
 * });
 * ```
 */

// User-facing defineConfig API.
export { defineConfig, VexConfig } from "./schema.js";
