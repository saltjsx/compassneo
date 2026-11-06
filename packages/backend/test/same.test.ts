import { describe, expect, test } from "bun:test";
import { same } from "../convex/lib/same";

describe("same", () => {
  test("the same data in another key order is the same", () => {
    expect(same({ a: 1, b: { c: [1, 2], d: "x" } }, { b: { d: "x", c: [1, 2] }, a: 1 })).toBe(true);
  });

  test("an undefined field counts as absent, as Convex stores it", () => {
    expect(same({ a: 1, note: undefined }, { a: 1 })).toBe(true);
    expect(same([{ a: 1 }], [{ a: 1, b: undefined }])).toBe(true);
  });

  test("any real difference is a change", () => {
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(same("1", 1)).toBe(false);
    expect(same(null, {})).toBe(false);
  });

  test("bytes compare by content", () => {
    expect(same(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2]).buffer)).toBe(true);
    expect(same(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 3]).buffer)).toBe(false);
  });
});
