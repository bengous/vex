/**
 * providers command - List registered VLM providers and their models.
 *
 * Usage: vex providers [options]
 *
 * Migrated to @effect/cli with Effect Schema validation.
 */

import type { ProviderInfo } from "../../providers/shared/introspection.js";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { loadConfigOptional } from "../../config/loader.js";
import { BUILTIN_PROFILES } from "../../providers/codex-cli/schema.js";
import { getAllProviders } from "../../providers/shared/introspection.js";
import { jsonOption } from "../options.js";

const showProfilesOption = Options.boolean("show-profiles").pipe(
  Options.withDescription("Show available profiles for each provider"),
  Options.withDefault(false),
);

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

function formatProvider(info: ProviderInfo): string {
  const lines: string[] = [];
  const status = info.available ? "✓ available" : "✗ unavailable";

  lines.push(`${info.displayName} [${info.name}]`);
  lines.push(`  Status: ${status}`);
  lines.push(`  Type: ${info.type.toUpperCase()}${info.command ? ` (${info.command})` : ""}`);

  if (info.models.length > 0) {
    lines.push("  Models:");
    for (const model of info.models) {
      lines.push(`    - ${model}`);
    }
  }

  if (info.modelAliases && Object.keys(info.modelAliases).length > 0) {
    lines.push("  Aliases:");
    for (const [alias, target] of Object.entries(info.modelAliases)) {
      lines.push(`    ${alias} → ${target}`);
    }
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Providers Command
// ═══════════════════════════════════════════════════════════════════════════

/** Build profile info for a provider if --show-profiles is set */
function getProfileInfo(
  providerName: string,
  showProfiles: boolean,
  config?: { providers?: { codex?: Record<string, unknown> } },
): { builtin: string[]; user: string[] } | undefined {
  if (!showProfiles) {
    return undefined;
  }
  if (providerName !== "codex-cli") {
    return undefined;
  }

  return {
    builtin: Object.keys(BUILTIN_PROFILES),
    user: Object.keys(config?.providers?.codex ?? {}),
  };
}

function formatProviderWithProfiles(
  info: ProviderInfo,
  profiles?: { builtin: string[]; user: string[] },
): string {
  let output = formatProvider(info);

  if (profiles) {
    output += "\n  Profiles:";
    if (profiles.builtin.length > 0) {
      output += `\n    Built-in: ${profiles.builtin.join(", ")}`;
    }
    if (profiles.user.length > 0) {
      output += `\n    User-defined: ${profiles.user.join(", ")}`;
    }
  }

  return output;
}

/**
 * Providers command implementation.
 */
export const providersCommand = Command.make(
  "providers",
  {
    json: jsonOption,
    showProfiles: showProfilesOption,
  },
  (args) =>
    Effect.gen(function* () {
      const providers = yield* getAllProviders();
      const config = args.showProfiles ? yield* loadConfigOptional() : undefined;

      if (args.json) {
        const output = providers.map((p) => ({
          ...p,
          ...(args.showProfiles &&
            p.name === "codex-cli" && {
              profiles: getProfileInfo(p.name, args.showProfiles, config),
            }),
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      console.log("\nVEX Providers");
      console.log("=============\n");

      for (const provider of providers) {
        const profiles = getProfileInfo(provider.name, args.showProfiles, config);
        console.log(formatProviderWithProfiles(provider, profiles));
        console.log("");
      }

      const available = providers.filter((p) => p.available).length;
      console.log(`Total: ${providers.length} providers (${available} available)`);
    }),
).pipe(Command.withDescription("List registered VLM providers and models"));
