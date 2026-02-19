/**
 * Vex Configuration File
 *
 * This file defines presets for the vex CLI tool.
 * Copy this to `vex.config.ts` and customize.
 *
 * Usage:
 *   vex scan <url> --preset <name>
 *   vex loop <url> --preset <name> --project <path>
 */
import { defineConfig } from './src/config/index.js';

export default defineConfig({
  // Required: where to save session output
  outputDir: 'vex-output',

  // Scan command presets
  scanPresets: {
    // Quick development testing (low reasoning, fast)
    quick: {
      devices: 'desktop-b3ngous-arch', // Your 1440x1248 setup
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      full: false,
    },

    // Full dev test (high reasoning, annotated) - ACCEPTANCE TEST PRESET
    'dev-full': {
      devices: 'desktop-b3ngous-arch', // Your 1440x1248 setup
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'high',
      },
      full: true,
    },

    // Mobile quick check
    'quick-mobile': {
      devices: 'iphone-15-pro',
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      full: false,
    },

    // Responsive audit (multiple devices)
    responsive: {
      devices: ['desktop-1920', 'iphone-15-pro', 'ipad-pro-11'],
      provider: {
        name: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      },
      full: true,
      placeholderMedia: true,
    },

    // Batch scan multiple pages
    'site-pages': {
      urls: ['https://example.com/', 'https://example.com/about', 'https://example.com/contact'],
      devices: ['desktop-1920', 'iphone-15-pro'],
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
    },
  },

  // Loop command presets
  loopPresets: {
    // Safe testing (no code changes)
    safe: {
      devices: 'desktop-1920',
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      maxIterations: 3,
      autoFix: 'none',
      dryRun: true,
    },

    // Aggressive fixing
    aggressive: {
      devices: 'desktop-1920',
      provider: {
        name: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      },
      maxIterations: 10,
      autoFix: 'medium',
      dryRun: false,
    },
  },
});
