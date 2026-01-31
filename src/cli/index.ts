#!/usr/bin/env bun

/**
 * vex CLI - Visual Explorer for web layout analysis.
 *
 * Commands:
 *   scan <url>       - Capture and analyze a URL
 *   analyze <image>  - Analyze an existing screenshot
 *   locate <session> - Find code locations for issues in a session
 *   loop <url>       - Run iterative improvement loop
 *   verify <session> - Compare iterations in a session
 *   providers        - List registered VLM providers
 */

import { analyzeCommand } from './commands/analyze.js';
import { locateCommand } from './commands/locate.js';
import { loopCommand } from './commands/loop.js';
import { providersCommand } from './commands/providers.js';
// During migration: use legacy scan command
import { scanCommand } from '../cli-legacy/commands/scan.js';
import { verifyCommand } from './commands/verify.js';

const HELP = `
vex - Visual Explorer for web layout analysis

Usage: vex <command> [options]

Commands:
  scan <url>        Capture screenshot and analyze for issues
  analyze <image>   Analyze an existing screenshot file
  locate <session>  Find code locations for issues in a session
  loop <url>        Run iterative improvement loop
  verify <session>  Compare iterations and show verification
  providers         List registered VLM providers and models

Options:
  --help, -h        Show this help message
  --version, -v     Show version

Examples:
  vex scan https://example.com
  vex scan https://example.com --viewport 1920x1080
  vex analyze ./screenshots/page.png
  vex loop https://example.com --max-iterations 5
  vex locate ./sessions/session_123
  vex providers --json
`;

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];

  // Handle global flags
  if (command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(`vex ${VERSION}`);
    process.exit(0);
  }

  // Route to command handlers
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case 'scan':
        await scanCommand(commandArgs);
        break;
      case 'analyze':
        await analyzeCommand(commandArgs);
        break;
      case 'locate':
        await locateCommand(commandArgs);
        break;
      case 'loop':
        await loopCommand(commandArgs);
        break;
      case 'verify':
        await verifyCommand(commandArgs);
        break;
      case 'providers':
        await providersCommand(commandArgs);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
