import type { SignalListener } from "../ports.js";
import { Effect } from "effect";

export const ProcessSignals: SignalListener = {
  onInterrupt: (handler) =>
    Effect.sync(() => {
      const onSigInt = () => handler("SIGINT");
      const onSigTerm = () => handler("SIGTERM");
      process.on("SIGINT", onSigInt);
      process.on("SIGTERM", onSigTerm);

      return Effect.sync(() => {
        process.off("SIGINT", onSigInt);
        process.off("SIGTERM", onSigTerm);
      });
    }),
};
