import type { ManifestStore } from "../ports.js";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";

export const FsManifestStore: ManifestStore = {
  initLayout: (plan, urls) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(join(plan.auditDir, "pages"), { recursive: true });
      yield* fs.writeFileString(plan.urlsPath, `${urls.join("\n")}\n`);
    }),

  writeConfigUsed: (plan, payload) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(plan.configUsedPath, JSON.stringify(payload, null, 2));
    }),

  saveManifest: (plan, manifest) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(plan.auditManifestPath, JSON.stringify(manifest, null, 2));
    }),
};
