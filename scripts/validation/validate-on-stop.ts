#!/usr/bin/env bun

import { CODE_PATTERN, classifyScopes, expandConfigScope, getChangedFiles } from "./detect-scope";
import { resolveBin, resolveProjectRoot } from "./resolve-bin";
import { runCommand } from "./run-command";

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot(import.meta.dir);
  const files = await getChangedFiles("working");
  const codeFiles = files.filter((file) => CODE_PATTERN.test(file));

  if (codeFiles.length === 0) {
    process.exit(0);
  }

  const scopes = expandConfigScope(classifyScopes(codeFiles));
  const oxlint = resolveBin(projectRoot, "oxlint");
  const errors: string[] = [];

  if (scopes.has("backend") || scopes.has("scripts")) {
    runCommand(
      "lint:errors",
      [oxlint, "-c", ".oxlintrc.jsonc", "--quiet", "--format=unix", "src/", "scripts/"],
      projectRoot,
      errors,
    );
    runCommand("format:check", ["bun", "run", "--silent", "format:check"], projectRoot, errors);
  }
  if (scopes.has("frontend")) {
    runCommand(
      "typecheck:frontend",
      ["bun", "run", "--silent", "typecheck:frontend"],
      projectRoot,
      errors,
    );
    runCommand("lint:frontend", ["bun", "run", "--silent", "lint:frontend"], projectRoot, errors);
    runCommand(
      "lint:css:frontend",
      ["bun", "run", "--silent", "lint:css:frontend"],
      projectRoot,
      errors,
    );
    runCommand(
      "format:check:frontend",
      ["bun", "run", "--silent", "format:check:frontend"],
      projectRoot,
      errors,
    );
  }

  if (errors.length > 0) {
    process.stderr.write(`Validation failed:\n${errors.join("\n\n")}\n`);
    process.exit(2);
  }
}

if (import.meta.main) {
  await main();
}
