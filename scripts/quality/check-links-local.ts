#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const processModule = process;
void processModule;

const DOC_EXTENSIONS = new Set([".md", ".html"]);
const MISE_ENV = {
  ...Bun.env,
  BUN_INSTALL: Bun.env.BUN_INSTALL ?? "/tmp/bun-install",
  BUN_TMPDIR: Bun.env.BUN_TMPDIR ?? "/tmp",
};

function resolveLycheeCommand(): string[] | undefined {
  const direct = Bun.spawnSync(["lychee", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (direct.exitCode === 0) {
    return ["lychee"];
  }

  const mise = Bun.spawnSync(["mise", "exec", "--", "lychee", "--version"], {
    env: MISE_ENV,
    stdout: "ignore",
    stderr: "ignore",
  });
  if (mise.exitCode === 0) {
    return ["mise", "exec", "--", "lychee"];
  }

  return undefined;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function walkDocs(dir: string, root = dir): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDocs(fullPath, root));
      continue;
    }

    const relativePath = normalizePath(fullPath.slice(root.length + 1));
    const extension = relativePath.includes(".")
      ? relativePath.slice(relativePath.lastIndexOf("."))
      : "";
    if (DOC_EXTENSIONS.has(extension)) {
      results.push(relativePath);
    }
  }
  return results;
}

export function collectLinkCheckFiles(root = process.cwd()): string[] {
  const files = new Set<string>();

  const readmePath = join(root, "README.md");
  if (existsSync(readmePath)) {
    files.add("README.md");
  }

  const docsPath = join(root, "docs");
  if (existsSync(docsPath)) {
    for (const file of walkDocs(docsPath, root)) {
      files.add(file);
    }
  }

  return [...files].toSorted((left, right) => left.localeCompare(right));
}

function main(): void {
  const files = collectLinkCheckFiles();

  if (files.length === 0) {
    console.error("Local link checking expected README.md or docs/**/*.{md,html}, but found none.");
    process.exit(1);
  }

  const lycheeCommand = resolveLycheeCommand();
  if (!lycheeCommand) {
    console.error("Lychee is required for local checks. Run `mise install` from the repo root.");
    process.exit(1);
  }

  const lint = Bun.spawnSync(
    [
      ...lycheeCommand,
      "--offline",
      "--no-progress",
      "--format",
      "compact",
      "--root-dir",
      ".",
      ...files,
    ],
    { env: MISE_ENV, stdout: "inherit", stderr: "inherit" },
  );

  process.exit(lint.exitCode);
}

if (import.meta.main) {
  main();
}
