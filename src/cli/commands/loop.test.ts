import { describe, expect, test } from "bun:test";
import { createLoopOptions } from "../../testing/factories.js";
import { createGateConfigFromLoopOptions } from "./loop.js";

describe("createGateConfigFromLoopOptions", () => {
  test.each(["high", "medium", "none"] as const)(
    "maps autoFixThreshold=%s to gate autoFixConfidence",
    (threshold) => {
      const loopOptions = createLoopOptions({ autoFixThreshold: threshold });

      const gateConfig = createGateConfigFromLoopOptions(loopOptions);

      expect(gateConfig).toEqual({
        autoFixConfidence: threshold,
      });
    },
  );
});
