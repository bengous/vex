import { describe, expect, test } from "bun:test";
import { runEffect } from "../../../testing/effect-helpers.js";
import { ProcessSignals } from "./process-signals.js";

describe("ProcessSignals", () => {
  test("registers interrupt handlers and cleanup removes them", async () => {
    const beforeSigint = process.listeners("SIGINT").length;
    const beforeSigterm = process.listeners("SIGTERM").length;
    const received: string[] = [];
    const cleanup = await runEffect(
      ProcessSignals.onInterrupt((signal) => {
        received.push(signal);
      }),
    );

    expect(process.listeners("SIGINT").length).toBe(beforeSigint + 1);
    process.emit("SIGINT");
    await runEffect(cleanup);

    expect(received).toEqual(["SIGINT"]);
    expect(process.listeners("SIGINT").length).toBe(beforeSigint);
    expect(process.listeners("SIGTERM").length).toBe(beforeSigterm);
  });
});
