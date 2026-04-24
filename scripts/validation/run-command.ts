export function runCommand(label: string, cmd: string[], cwd: string, errors: string[]): void {
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const output = [result.stderr.toString(), result.stdout.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    errors.push(`[${label}] ${output || `exited with code ${result.exitCode}`}`);
  }
}
