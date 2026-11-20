import { describe, expect, it } from "vitest";
import { stableHash } from "@/lib/input-hash";

describe("stableHash", () => {
  it("is identical for objects with the same keys in a different order", () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });

  it("is identical for nested objects regardless of key order", () => {
    expect(stableHash({ a: { x: 1, y: 2 }, b: [{ p: 1, q: 2 }] })).toBe(
      stableHash({ b: [{ q: 2, p: 1 }], a: { y: 2, x: 1 } })
    );
  });

  it("changes when a value changes", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it("is sensitive to array order (callers must sort first)", () => {
    expect(stableHash([{ id: "1" }, { id: "2" }])).not.toBe(stableHash([{ id: "2" }, { id: "1" }]));
  });

  it("treats null and undefined as distinct from each other and from absent keys", () => {
    expect(stableHash({ a: null })).not.toBe(stableHash({}));
    expect(stableHash({ a: undefined })).toBe(stableHash({}));
  });
});
