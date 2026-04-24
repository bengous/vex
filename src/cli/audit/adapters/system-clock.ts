import type { Clock } from "../ports.js";

export const SystemClock: Clock = {
  now: () => new Date().toISOString(),
};
