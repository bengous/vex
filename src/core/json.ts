import { Schema as S } from "effect";

const JsonUnknown = S.parseJson(S.Unknown);
const PrettyJsonUnknown = S.parseJson(S.Unknown, { space: 2 });

export function encodeJson(value: unknown): string {
  return S.encodeSync(PrettyJsonUnknown)(value);
}

export function decodeJson(value: string): unknown {
  return S.decodeUnknownSync(JsonUnknown)(value);
}
