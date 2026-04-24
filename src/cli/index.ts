#!/usr/bin/env bun

/**
 * vex CLI - Visual Explorer for web layout analysis.
 *
 * New entry point using @effect/cli.
 * Commands are added incrementally as they're migrated.
 *
 * Commands:
 *   scan <url>       - Capture and analyze a URL
 *   analyze <image>  - Analyze an existing screenshot
 *   locate <session> - Find code locations for issues in a session
 *   loop <url>       - Run iterative improvement loop
 *   verify <session> - Compare iterations in a session
 *   providers        - List registered VLM providers
 */

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
// Initialize providers once at CLI entry
import "../providers/init.js";
import { analyzeCommand } from "./commands/analyze.js";
import { locateCommand } from "./commands/locate.js";
import { loopCommand } from "./commands/loop.js";
import { providersCommand } from "./commands/providers.js";
import { scanCommand } from "./commands/scan.js";
import { verifyCommand } from "./commands/verify.js";

const VERSION = "0.1.0";

/**
 * Root vex command.
 * Subcommands added incrementally during migration.
 */
const vexCommand = Command.make("vex", {}, () =>
  Effect.sync(() => {
    console.log(`vex ${VERSION} - Visual Explorer for web layout analysis`);
    console.log("");
    console.log("Use --help to see available commands.");
  }),
).pipe(
  Command.withDescription("Visual extraction and analysis tool"),
  Command.withSubcommands([
    analyzeCommand,
    locateCommand,
    loopCommand,
    providersCommand,
    scanCommand,
    verifyCommand,
  ]),
);

/**
 * CLI runner with @effect/cli.
 */
const cli = Command.run(vexCommand, {
  name: "vex",
  version: VERSION,
});

// @effect-diagnostics-next-line strictEffectProvide:off
Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
